import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { runPlanStage } from "../src/plan-stage.ts";
import { AGENTS } from "../src/agents.ts";
import { freezeProfile } from "../src/profile.ts";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { policyHash } from "../src/policy.ts";
import type { ExecutorDefinition } from "../src/executor.ts";
import type { VerificationConfig } from "../src/governed-config.ts";

/** One minimal frozen configuration; this stage does not read it. */
const VERIFICATION: VerificationConfig = { commands: [{ name: "unit", command: ["node", "--version"] }] };
const FIXTURE = join(process.cwd(), "test", "fixtures", "harness", "emit-plan-stage.mjs");
const COMMIT = "b".repeat(40);
const MODEL = "m";
const SLUG = "demo";

/**
 * The approved specification. Two declared artifacts on a feature run is low
 * risk, which seats a panel of one — the tests that care about panel size say
 * so explicitly rather than relying on this.
 */
const SPEC = `feature: demo
change_kind: feature

## Declared artifacts

- src/a1.ts
- test/a1.test.ts

## Acceptance criteria

- AC-001: the thing works
- AC-002: it is observable
- AC-003: it stays working
`;

const SCOPE = ["src/a1.ts", "test/a1.test.ts"];

// A defect fix touching a protected path scores 3: high risk, a panel of
// three — the only size the seeded registry staffs exactly, which is why the
// short-panel path needs the selectPanel seam to be provable.
const HIGH_SPEC = SPEC.replace("change_kind: feature", "change_kind: defect_fix").replace(
  "- src/a1.ts",
  "- src/agents/evil.ts"
);
const HIGH_SCOPE = ["src/agents/evil.ts", "test/a1.test.ts"];

function fixtureExecutor(scriptPath: string): ExecutorDefinition {
  return {
    // The fixture simulates the claude-code executor: the run's frozen
    // profile freezes the fixture each test hands (see withApprovedRun and
    // the per-scratch freeze calls), so the stage's binding checks see the
    // fixture as the executor the run froze.
    id: "claude-code",
    command: ["node", scriptPath],
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

/** The fixture source, normalized at the read boundary (hazard 12). */
function fixtureSource(): string {
  return normalizeText(readFileSync(FIXTURE, "utf8"));
}

/**
 * Freeze a profile whose executor is the fixture the tests hand. The
 * stage's binding checks compare the handed executor against the frozen
 * one canonically, so a test run must freeze exactly what it hands — the
 * fixture-blindness answer: a run that hands an executor its profile never
 * froze must be refused, and fixture tests are not exempt from that
 * contract.
 */
function freezeExecutorIntoProfile(
  store: Store,
  root: string,
  runId: number,
  executor: ExecutorDefinition
): void {
  const path = join(root, ".governance", "profiles", String(runId), "profile.json");
  const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  profile.executor = executor;
  const serialized = canonicalJson(profile);
  writeFileSync(path, serialized);
  store.setProfileRef(runId, sha256Hex(serialized));
}

/**
 * Rewrite one or more frozen policy values and re-freeze, recomputing both
 * `policyHash` and the profile hash on the run row.
 *
 * Active policy values such as panel size and round counts come from the
 * frozen profile, so a test that wants another configuration has to freeze
 * one. Recomputing `policyHash` matters: the profile validity check refuses a
 * profile whose recorded hash does not describe its own policy, so a lazy
 * patch here would be refused rather than honoured.
 */
function freezePolicyInto(
  store: Store,
  root: string,
  runId: number,
  patch: Record<string, unknown>
): void {
  const path = join(root, ".governance", "profiles", String(runId), "profile.json");
  const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const policy = { ...(profile.policy as Record<string, unknown>), ...patch };
  profile.policy = policy;
  profile.policyHash = policyHash(policy as never);
  const serialized = canonicalJson(profile);
  writeFileSync(path, serialized);
  store.setProfileRef(runId, sha256Hex(serialized));
}

interface Ctx {
  store: Store;
  root: string;
  runId: number;
  specPath: string;
  approvalStageId: number;
}

/**
 * A run parked exactly where the plan stage expects it: spec written and
 * gated, approval recorded, `awaiting_approval` passed. No dispatch anywhere —
 * every precondition must be reachable without spending.
 */
function withApprovedRun(
  fn: (ctx: Ctx) => Promise<void>,
  opts: {
    spec?: string;
    scope?: string[];
    gateSummary?: string | null;
    approval?: boolean;
    changeKind?: string;
  } = {}
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-plan-stage-"));
  const store = openStore(root);
  const spec = opts.spec ?? SPEC;
  try {
    const run = store.insertRun("p", "f-1", SLUG, opts.changeKind ?? "feature");
    const frozen = freezeProfile(root, run.id, COMMIT, MODEL, VERIFICATION);
    store.setProfileRef(run.id, frozen.hash);
    // The run's frozen executor *is* the fixture the tests hand by default;
    // scratch-executor tests freeze their own right before the stage call.
    freezeExecutorIntoProfile(store, root, run.id, fixtureExecutor(FIXTURE));

    const specPath = join(root, "docs", "features", SLUG, "spec.md");
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(specPath, spec);

    const specStage = store.insertStage(run.id, "spec", null);
    store.completeStage(specStage.id, specPath, "pass");
    const reviewStage = store.insertStage(run.id, "spec_review", specStage.id);
    store.completeStage(reviewStage.id, specPath, "pass");

    // The audit table is append-only by trigger, so the absent and malformed
    // cases are configured here rather than deleted afterwards.
    if (opts.gateSummary === undefined) {
      appendAudit(store, {
        runId: run.id,
        stageId: reviewStage.id,
        actor: "system",
        actorType: "cli",
        action: "spec.gate.pass",
        summary: `spec_review gate passed after 1 round(s); specHash=${sha256Hex(normalizeText(spec))}; risk=low`,
      });
    } else if (opts.gateSummary !== null) {
      appendAudit(store, {
        runId: run.id,
        stageId: reviewStage.id,
        actor: "system",
        actorType: "cli",
        action: "spec.gate.pass",
        summary: opts.gateSummary,
      });
    }

    const approvalStage = store.insertStage(run.id, "awaiting_approval", reviewStage.id);
    store.completeStage(approvalStage.id, specPath, "pass");
    if (opts.approval !== false) {
      store.insertApproval({
        runId: run.id,
        featureId: "f-1",
        specHash: sha256Hex(normalizeText(spec)),
        startingCommit: COMMIT,
        profileHash: frozen.hash,
        risk: "low",
        scope: canonicalJson(opts.scope ?? SCOPE),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        signature: "sig",
        signer: "signer",
      });
    }

    return Promise.resolve(
      fn({ store, root, runId: run.id, specPath, approvalStageId: approvalStage.id })
    ).finally(() => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    });
  } catch (err) {
    store.close();
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
}

function agentRunCounts(store: Store, runId: number): { author: number; reviewer: number } {
  const rows = store.query<{ role: string }>(
    "SELECT ar.role FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ?",
    [runId]
  );
  return {
    author: rows.filter((r) => r.role === "author").length,
    reviewer: rows.filter((r) => r.role === "reviewer").length,
  };
}

function auditSummaries(store: Store, runId: number, action: string): string[] {
  return store
    .query<{ summary: string }>("SELECT summary FROM audit WHERE run_id = ? AND action = ? ORDER BY id", [
      runId,
      action,
    ])
    .map((r) => r.summary);
}

// --- the success path, and round semantics (step 5b Task 9) -----------------

test("the happy path chains plan and plan_review from the approved stage, and gates on decision completeness", async () => {
  await withApprovedRun(async ({ store, root, runId, approvalStageId }) => {
    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    if (!result.ok) return;

    const chain = store.getStageChain(runId);
    assert.deepEqual(
      chain.map((s) => s.kind),
      ["spec", "spec_review", "awaiting_approval", "plan", "plan_review"]
    );
    const planStage = chain.find((s) => s.kind === "plan")!;
    const reviewStage = chain.find((s) => s.kind === "plan_review")!;
    // Section 4's handoff: the plan stage chains from the approved row.
    assert.equal(planStage.input_stage_id, approvalStageId);
    assert.equal(reviewStage.input_stage_id, planStage.id);
    assert.equal(planStage.status, "passed");
    assert.equal(reviewStage.status, "passed");
    assert.equal(planStage.output_ref, result.planPath);
    assert.equal(reviewStage.output_ref, result.planPath);

    const plan = readFileSync(result.planPath, "utf8");
    assert.ok(plan.includes("REVISED-plan"), "the reconciled revision was written");
    assert.equal(verifyAuditChain(store), null);
    assert.equal(store.getRun(runId)!.status, "in_progress");
    const counts = agentRunCounts(store, runId);
    // Draft, self-critique, and exactly one reconciliation: the default
    // frozen policy configures one round, and the gate decides over that
    // round's decisions rather than requiring a second, empty-findings panel.
    assert.equal(counts.author, 3);
    assert.equal(counts.reviewer, 2);
    const records = auditSummaries(store, runId, "plan.reconcile.record");
    assert.equal(records.length, 1, "exactly one reconciliation event for one configured round");
    const round1 = records[0];
    assert.ok(!round1.includes("->cannot_determine"), "no happy-path decision was converted");
    assert.match(round1, /unclaimed=0/);
    // Both directions are accounted for: the fixture's revision replaces a
    // task line and claims both halves, so neither an addition nor a removal
    // is left over.
    assert.match(round1, /unclaimedRemoved=0/);
    const findings = store.getCanonicalFindings(reviewStage.id);
    assert.equal(findings.length, 2);
    assert.ok(findings.every((f) => f.round === 1));
    for (const finding of findings) {
      assert.match(round1, new RegExp(`d${finding.id}=addressed`), `finding ${finding.id} kept its addressed disposition`);
    }
    const decisions = store.getFindingDecisions(reviewStage.id);
    assert.equal(decisions.length, 2);
    assert.ok(decisions.every((d) => d.disposition === "addressed"));
  });
});

test("the passing gate records the plan hash, the plan_for binding, and the risk it gated", async () => {
  await withApprovedRun(async ({ store, root, runId, specPath }) => {
    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    if (!result.ok) return;
    const onDisk = sha256Hex(normalizeText(readFileSync(result.planPath, "utf8")));
    const specHash = sha256Hex(normalizeText(readFileSync(specPath, "utf8")));
    const summaries = auditSummaries(store, runId, "plan.gate.pass");
    assert.equal(summaries.length, 1);
    // Pinned exactly, not matched as an alternation: the recorded risk is what
    // the approval binds, so a computeRisk regression must fail this test.
    assert.equal(
      summaries[0],
      `plan_review gate passed after 1 round(s); planHash=${onDisk}; planFor=${specHash}; risk=low`
    );
    // Panel size is the count of distinct reviewers seated, not of dispatch
    // rows — the same panel dispatches once per round. It is the frozen floor
    // regardless of the risk recorded above, which is the decoupling this
    // assertion now protects.
    const distinctReviewers = store.query<{ n: number }>(
      "SELECT COUNT(DISTINCT ar.agent) AS n FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? AND ar.role = 'reviewer'",
      [runId]
    )[0].n;
    assert.equal(distinctReviewers, 2, "the author asked for two, whatever the risk");
  });
});

test("a configured round count runs panel then reconciliation that many times, with one self-critique in total, and a recurring identity gets a distinct round-scoped canonical row each round", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The reviewer branch is made unconditional — it reports the same two
    // findings every round regardless of whether the plan was revised — so
    // the same intent/location genuinely recurs in round 2 rather than the
    // panel simply seeing nothing left to report.
    const scratch = join(root, "emit-plan-recurring.mjs");
    const source = fixtureSource().replace('stdin.includes("REVISED-plan")', "false");
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, { planReviewRounds: 2 });
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const counts = agentRunCounts(store, runId);
    assert.equal(counts.author, 4, "draft, one self-critique, and one reconciliation per round");
    assert.equal(counts.reviewer, 4, "two reviewers seated in each of two rounds");
    const reviewStage = store.getStageChain(runId).find((s) => s.kind === "plan_review")!;
    const findings = store.getCanonicalFindings(reviewStage.id);
    assert.equal(findings.length, 4, "two identities, each raised once per round");
    for (const round of [1, 2]) {
      const inRound = findings.filter((f) => f.round === round);
      assert.equal(inRound.length, 2, `round ${round} raised both identities`);
      assert.deepEqual(
        inRound.map((f) => f.intent_key).sort(),
        ["coverage-gap", "nit-pick"]
      );
    }
    const coverageGapIds = findings.filter((f) => f.intent_key === "coverage-gap").map((f) => f.id);
    assert.equal(new Set(coverageGapIds).size, 2, "round 1 and round 2 are distinct canonical identities");
    for (const finding of findings) {
      assert.equal(store.getFindingReports(finding.id).length, 2, "neither round's reports overwrote the other");
    }
    const decisions = store.getFindingDecisions(reviewStage.id);
    assert.equal(decisions.length, 4);
    assert.ok(decisions.every((d) => d.disposition === "addressed"));
    const gate = auditSummaries(store, runId, "plan.gate.pass")[0]!;
    assert.match(gate, /gate passed after 2 round\(s\)/);
  });
});

test("the gate blocks on a cannot_determine decision from an earlier round even though a later round finds nothing new", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // Round 1's reconciler converts one of its two decisions to
    // cannot_determine outright (no grounding, no claim); the other still
    // claims the revision, so the revised plan still satisfies the normative
    // accounting. Round 2's panel then sees the REVISED-plan marker and
    // reports nothing, so its own reconciliation returns zero decisions —
    // proving the gate still blocks on round 1's alone.
    const scratch = join(root, "emit-plan-earlier-round-blocks.mjs");
    const source = fixtureSource().replace(
      `  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["## Tasks"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "## Tasks",
              artifactText: "Build the thing REVISED-plan",
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
            {
              artifactLocation: "## Tasks",
              artifactText: supersededTask(current),
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
          ]
        : [],
  }));`,
      `  const decisions = ids.map((id, index) => {
    const disposition = index === 0 ? "cannot_determine" : "addressed";
    const base = {
      findingId: id,
      disposition,
      rationale: index === 0 ? "fixture cannot determine" : "fixture addressed the finding",
      changedLocations: ["## Tasks"],
    };
    if (disposition !== "addressed") return base;
    return {
      ...base,
      normativeChanges:
        revising && index === 1
          ? [
              {
                artifactLocation: "## Tasks",
                artifactText: "Build the thing REVISED-plan",
                grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
              },
              {
                artifactLocation: "## Tasks",
                artifactText: supersededTask(current),
                grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
              },
            ]
          : [],
    };
  });`
    );
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, { planReviewRounds: 2 });
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    const reviewStage = store.getStageChain(runId).find((s) => s.kind === "plan_review")!;
    const decisions = store.getFindingDecisions(reviewStage.id);
    assert.equal(decisions.length, 2, "round 2 produced no new decisions to report on");
    const blocked = decisions.find((d) => d.disposition === "cannot_determine")!;
    assert.match(result.reason, new RegExp(`finding id\\(s\\) ${blocked.finding_id}`));
    assert.equal(store.getProposalsForStage(reviewStage.id).length, 0, "cannot_determine claims no proposal candidate");
    assert.equal(store.getRun(runId)!.status, "blocked");
    assert.ok(store.getApproval(runId), "the approval the operator signed is untouched by a blocked review");
    assert.equal(verifyAuditChain(store), null, "the audit chain still validates on a blocked run");
  });
});

test("upstream_follow_up stores a proposal, names every source finding, and does not block", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-plan-follow-up.mjs");
    const source = fixtureSource().replace(
      `  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["## Tasks"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "## Tasks",
              artifactText: "Build the thing REVISED-plan",
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
            {
              artifactLocation: "## Tasks",
              artifactText: supersededTask(current),
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
          ]
        : [],
  }));`,
      `  const decisions = ids.map((id, index) => {
    const disposition = index === 0 ? "upstream_follow_up" : "addressed";
    const base = {
      findingId: id,
      disposition,
      rationale: index === 0 ? "fixture routes upstream" : "fixture addressed the finding",
      changedLocations: ["## Tasks"],
    };
    if (disposition !== "addressed") {
      return {
        ...base,
        proposal: { title: "spec gap", problem: "the specification never says this", whyUpstream: "the plan cannot invent it" },
      };
    }
    return {
      ...base,
      normativeChanges:
        revising && index === 1
          ? [
              {
                artifactLocation: "## Tasks",
                artifactText: "Build the thing REVISED-plan",
                grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
              },
              {
                artifactLocation: "## Tasks",
                artifactText: supersededTask(current),
                grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
              },
            ]
          : [],
    };
  });`
    );
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    // Round count is fixed by policy, not reactive to disposition: the
    // upstream concern does not trigger an extra plan-author revision round
    // aimed at repairing an artifact that cannot fix an upstream omission.
    assert.equal(agentRunCounts(store, runId).author, 3, "draft, self-critique, and exactly one reconciliation");
    const reviewStage = store.getStageChain(runId).find((s) => s.kind === "plan_review")!;
    const decisions = store.getFindingDecisions(reviewStage.id);
    const routed = decisions.find((d) => d.disposition === "upstream_follow_up")!;
    const proposals = store.getProposalsForStage(reviewStage.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].route, "follow_up");
    assert.equal(proposals[0].title, "spec gap");
    assert.deepEqual(store.getProposalSources(proposals[0].id), [routed.finding_id]);
    // The evidence file lands under the governance directory, not in the
    // repository the operator would git-mv from (architecture section 14).
    assert.ok(existsSync(join(root, proposals[0].evidence_ref)), "proposal evidence was retained");
    assert.ok(!existsSync(join(root, "docs", "proposals")), "no run writes into docs/proposals/");
    // Its own queryable event, carrying the fields Task 8 step 8 names. The
    // spec stage asserts the same contract, and it has to exist twice: the
    // two orchestrators are duplicated on purpose, so nothing structural
    // notices an event wired on one side and only tested on the other.
    const recorded = auditSummaries(store, runId, "plan.proposal.record");
    assert.equal(recorded.length, 1, "one proposal event per persisted candidate");
    assert.match(recorded[0], new RegExp(`^proposal ${proposals[0].id} created;`));
    assert.match(recorded[0], new RegExp(`finding=${routed.finding_id};`));
    assert.match(recorded[0], /route=follow_up;/);
    assert.match(recorded[0], /risk=(low|standard|high);/);
    assert.match(recorded[0], /planHashBefore=[0-9a-f]{64}; planHashAfter=[0-9a-f]{64};/);
    assert.equal(verifyAuditChain(store), null, "the audit chain still verifies");
  });
});

test("upstream_blocking stores a proposal and blocks, naming both the finding and the proposal", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-plan-blocking.mjs");
    const source = fixtureSource().replace(
      `  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["## Tasks"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "## Tasks",
              artifactText: "Build the thing REVISED-plan",
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
            {
              artifactLocation: "## Tasks",
              artifactText: supersededTask(current),
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
          ]
        : [],
  }));`,
      `  const decisions = ids.map((id, index) => {
    const disposition = index === 0 ? "upstream_blocking" : "addressed";
    const base = {
      findingId: id,
      disposition,
      rationale: index === 0 ? "fixture routes upstream" : "fixture addressed the finding",
      changedLocations: ["## Tasks"],
    };
    if (disposition !== "addressed") {
      return {
        ...base,
        proposal: { title: "spec gap", problem: "the specification never says this", whyUpstream: "the plan cannot invent it" },
      };
    }
    return {
      ...base,
      normativeChanges:
        revising && index === 1
          ? [
              {
                artifactLocation: "## Tasks",
                artifactText: "Build the thing REVISED-plan",
                grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
              },
              {
                artifactLocation: "## Tasks",
                artifactText: supersededTask(current),
                grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
              },
            ]
          : [],
    };
  });`
    );
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    // Round count is fixed by policy, not reactive to disposition: the
    // upstream concern does not trigger an extra plan-author revision round
    // aimed at repairing an artifact that cannot fix an upstream omission.
    assert.equal(agentRunCounts(store, runId).author, 3, "draft, self-critique, and exactly one reconciliation");
    const reviewStage = store.getStageChain(runId).find((s) => s.kind === "plan_review")!;
    const decisions = store.getFindingDecisions(reviewStage.id);
    const routed = decisions.find((d) => d.disposition === "upstream_blocking")!;
    const proposals = store.getProposalsForStage(reviewStage.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].route, "blocking_dependency");
    assert.match(result.reason, new RegExp(`${routed.finding_id} \\(proposal ${proposals[0].id}\\)`));
    assert.equal(store.getRun(runId)!.status, "blocked");
    const recorded = auditSummaries(store, runId, "plan.proposal.record");
    assert.equal(recorded.length, 1);
    assert.match(recorded[0], new RegExp(`^proposal ${proposals[0].id} created;`));
    assert.match(recorded[0], /route=blocking_dependency;/);
    assert.match(recorded[0], new RegExp(`finding=${routed.finding_id};`));
    assert.ok(store.getApproval(runId), "the approval the operator signed is untouched by a blocked review");
    assert.equal(verifyAuditChain(store), null, "a blocked run's audit chain still verifies");
  });
});

test("the same upstream candidate raised in two rounds links one proposal and records the link", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The plan-side copy of the spec-side dedup proof. The identity key is
    // stage-scoped, so a candidate repeated in round 2 under its own
    // round-scoped canonical identity must link to round 1's proposal rather
    // than duplicate it — and the event has to say which happened, or a
    // later query cannot tell a repeated concern from two distinct ones.
    const scratch = join(root, "emit-plan-dedup-link.mjs");
    const source = fixtureSource()
      .replace('stdin.includes("REVISED-plan")', "false")
      .replace(
        `  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["## Tasks"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "## Tasks",
              artifactText: "Build the thing REVISED-plan",
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
            {
              artifactLocation: "## Tasks",
              artifactText: supersededTask(current),
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
          ]
        : [],
  }));`,
        `  const decisions = ids.map((id) => ({
    findingId: id,
    disposition: "upstream_follow_up",
    rationale: "fixture routes upstream",
    changedLocations: [],
    proposal: { title: "spec gap", problem: "the specification never says this", whyUpstream: "the plan cannot invent it" },
  }));`
      )
      // Nothing is revised, so no normative node is added for anyone to claim.
      .replace("const artifact = revising ? planDoc({ revised: true }) : current;", "const artifact = current;");
    // A substitution that silently fails to match leaves the stock fixture
    // running and the test asserting nothing it means to (hazard 12's shape).
    assert.ok(source.includes("const artifact = current;"), "the artifact substitution must apply");
    assert.ok(source.includes('disposition: "upstream_follow_up"'), "the decision substitution must apply");
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, { planReviewRounds: 2 });
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);

    const reviewStage = store.getStageChain(runId).find((s) => s.kind === "plan_review")!;
    const proposals = store.getProposalsForStage(reviewStage.id);
    assert.equal(proposals.length, 1, "one stored proposal, however many rounds raised it");
    const sources = store.getProposalSources(proposals[0].id);
    const upstreamDecisions = store
      .getFindingDecisions(reviewStage.id)
      .filter((d) => d.disposition === "upstream_follow_up");
    assert.equal(upstreamDecisions.length, 4, "two identities in each of two rounds");
    assert.deepEqual(sources.sort(), upstreamDecisions.map((d) => d.finding_id).sort());

    const recorded = auditSummaries(store, runId, "plan.proposal.record");
    assert.equal(recorded.length, 4, "one event per candidate, linked or created");
    assert.equal(recorded.filter((s) => s.includes(" created;")).length, 1, "only the first created the row");
    assert.equal(recorded.filter((s) => s.includes(" linked;")).length, 3, "every later candidate linked to it");
  });
});

test("a decision converted by an unmatched grounding is stored as cannot_determine and blocks by name, not discarded as an unclaimed node", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The plan-side copy of the spec-side proof, and the distinction the
    // stage must not collapse: the decision claims the added node, but its
    // grounding excerpt does not occur in the approved specification, so the
    // validator converts it to cannot_determine and drops its claims —
    // releasing the node into `unclaimedNodes` while an owning decision
    // survives and must reach storage and the gate.
    const scratch = join(root, "emit-plan-converted.mjs");
    const source = fixtureSource().replace(
      'grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },',
      'grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "a phrase the approved specification never contains" },'
    );
    assert.notEqual(source, fixtureSource(), "the grounding substitution must apply");
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;

    const reviewStage = store.getStageChain(runId).find((s) => s.kind === "plan_review")!;
    const converted = store.getFindingDecisions(reviewStage.id).find((d) => d.disposition === "cannot_determine");
    assert.ok(converted, "the converted decision must be persisted, not discarded with the round");
    assert.match(converted!.rationale, /\[deterministic validation: .*grounding excerpt does not occur/);
    assert.equal(converted!.grounding_source, null, "a converted decision drops its invalid conditional content");
    assert.equal(converted!.normative_changes, null);
    assert.match(result.reason, new RegExp(`finding id\\(s\\) .*\\b${converted!.finding_id}\\b`));
    assert.ok(
      !/unclaimed by any decision/.test(result.reason),
      `a converted decision must not be reported as unclaimed: ${result.reason}`
    );
    const record = auditSummaries(store, runId, "plan.reconcile.record")[0];
    assert.match(record, new RegExp(`${converted!.finding_id}:addressed->cannot_determine`));
    assert.match(record, /unclaimed=1/);
    // The conversion drops both of the decision's claims, so the superseded
    // task is released alongside the added one and both counts say so.
    assert.match(record, /unclaimedRemoved=1/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("an added node no decision claims aborts the round before any decision is persisted", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The plan-side copy of the spec-side proof: the fixture revises the task
    // line but claims nothing, so the derived added node has no owning
    // decision to convert and the round fails closed rather than persisting
    // an addressed decision the accounting cannot support.
    const scratch = join(root, "emit-plan-unclaimed.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace("    normativeChanges:\n      revising && index === 0", "    normativeChanges:\n      false")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /left normative node\(s\) unclaimed by any decision/);
    const reviewStage = store.getStageChain(runId).find((s) => s.kind === "plan_review")!;
    const findings = store.getCanonicalFindings(reviewStage.id);
    assert.equal(findings.length, 2);
    for (const finding of findings) {
      assert.ok(store.getFindingReports(finding.id).length > 0);
    }
    assert.equal(store.getFindingDecisions(reviewStage.id).length, 0, "no decision was persisted on an aborted round");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a removed node no decision claims aborts the round, naming the deleted node", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The plan-side copy of the spec-side hazard 17 proof: the reconciliation
    // answers both findings `addressed` and deletes a task line, claiming
    // nothing for it. A task is the node to delete rather than a coverage
    // line, because dropping a coverage line fails the coverage identity gate
    // first and would never reach the accounting.
    const scratch = join(root, "emit-plan-unclaimed-removal.mjs");
    const source = fixtureSource()
      .replace(
        "const artifact = revising ? planDoc({ revised: true }) : current;",
        'const artifact = revising ? current.replace("- Test the thing\\n", "") : current;'
      )
      .replace("    normativeChanges:\n      revising && index === 0", "    normativeChanges:\n      false");
    assert.ok(source.includes('current.replace("- Test the thing\\n", "")'), "the deletion substitution must apply");
    assert.ok(source.includes("    normativeChanges:\n      false"), "the claim substitution must apply");
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /left removed normative node\(s\) unclaimed by any decision/);
    assert.match(result.reason, /Test the thing/, "the refusal names the deleted node");

    const reviewStage = store.getStageChain(runId).find((s) => s.kind === "plan_review")!;
    assert.equal(store.getFindingDecisions(reviewStage.id).length, 0, "no decision was persisted on an aborted round");
    assert.equal(store.getRun(runId)!.status, "blocked");
    // The abort precedes decision insertion and the reconcile summary, so the
    // blocked round's evidence is the invalid event, not an `unclaimedRemoved`
    // token — there is no summary to carry one.
    const invalid = auditSummaries(store, runId, "plan.reconcile.invalid");
    assert.equal(invalid.length, 1);
    assert.match(invalid[0], /Test the thing/);
    assert.equal(
      auditSummaries(store, runId, "plan.reconcile.record").length,
      0,
      "the aborted round wrote no reconcile summary"
    );
  });
});

// --- preconditions, each refused by name before any dispatch ----------------

test("a nonexistent run is refused by name", async () => {
  await withApprovedRun(async ({ store, root }) => {
    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId: 9999, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /run 9999 does not exist/);
  });
});

test("a blocked run is refused before anything can be dispatched", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    store.setRunStatus(runId, "blocked");
    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /is blocked, not in_progress/);
    assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
  });
});

test("a run whose last stage is not a passed awaiting_approval is refused", async () => {
  await withApprovedRun(async ({ store, root, runId, approvalStageId }) => {
    // Add an unrelated later stage so the chain's tail is not the approval.
    store.insertStage(runId, "plan_review", approvalStageId);
    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /not a passed awaiting_approval/);
    assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
  });
});

test("a run that already has a plan stage is refused naming its status", async () => {
  await withApprovedRun(async ({ store, root, runId, approvalStageId }) => {
    store.insertStage(runId, "plan", approvalStageId);
    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /already has a plan stage with status pending/);
    assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
  });
});

test("a missing approval row is refused", async () => {
  await withApprovedRun(
    async ({ store, root, runId }) => {
      const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /run \d+ has no recorded approval/);
      assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
    },
    { approval: false }
  );
});

test("an unreadable approved spec is refused naming the path, before any dispatch", async () => {
  await withApprovedRun(async ({ store, root, runId, specPath }) => {
    rmSync(specPath);
    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /cannot read approved spec/);
    assert.ok(result.reason.includes(specPath));
    assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
  });
});

test("an approved spec with obsolete prose-only criteria names the fresh-run repair path", async () => {
  const obsolete = SPEC
    .replace("- AC-001: ", "- ")
    .replace("- AC-002: ", "- ")
    .replace("- AC-003: ", "- ");
  await withApprovedRun(
    async ({ store, root, runId }) => {
      const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /obsolete prose-only acceptance-criterion shape/);
      assert.match(result.reason, /start a fresh run to mint stable criterion IDs/);
      assert.equal(agentRunCounts(store, runId).author, 0, "the repair refusal precedes every dispatch");
    },
    { spec: obsolete }
  );
});

test("a model disagreeing with the frozen map is refused before any dispatch", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), {
      runId,
      requestedModel: "some-other-model",
      rootDir: root,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(
      result.reason,
      /--model some-other-model does not match the model frozen at run start \(m\): config is frozen at run start/
    );
    assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
  });
});

// --- the binding to what the operator approved ------------------------------

test("a spec edited after approval is refused by name before any dispatch", async () => {
  await withApprovedRun(async ({ store, root, runId, specPath }) => {
    // The panel gated one specification and the operator signed it. Editing
    // the file afterwards must not produce a plan bound to a spec no
    // signature covered — provenance through output_ref is not enough.
    writeFileSync(specPath, `${SPEC}\n- AC-004: something nobody approved\n`);
    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /the spec has changed since review: gated [0-9a-f]{64}, on disk [0-9a-f]{64}/);
    assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
  });
});

test("a run with no spec.gate.pass event is refused", async () => {
  await withApprovedRun(
    async ({ store, root, runId }) => {
      const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /has no spec\.gate\.pass audit event/);
      assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
    },
    { gateSummary: null }
  );
});

test("a spec.gate.pass event in the old prose shape is refused, not approved past", async () => {
  await withApprovedRun(
    async ({ store, root, runId }) => {
      const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /does not record a spec hash and risk/);
      assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
    },
    { gateSummary: "spec_review gate passed in round 1" }
  );
});

test("a plan whose plan_for names another specification is refused", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-wrong-plan-for.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        "planFor = specHash } = {}",
        'planFor = "c".repeat(64) } = {}'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /plan_for [0-9a-f]{64} does not match the approved spec hash/);
    // Terminal: the plan stage blocks and the run blocks with it.
    const planStage = store.getStageChain(runId).find((s) => s.kind === "plan")!;
    assert.equal(planStage.status, "blocked");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

// --- the unkeepable-promise gate --------------------------------------------

test("coverage outside the approved scope blocks before any reviewer is dispatched", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-out-of-scope.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        "proposedContentChanges: { plan: planDoc() },",
        "proposedContentChanges: { plan: planDoc({ outOfScope: true }) },"
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /plan promises coverage outside the approved scope/);
    assert.match(result.reason, /AC-001/);

    // The gate is deterministic and free, so it must run before the panel:
    // one author invocation, zero reviewer invocations.
    const counts = agentRunCounts(store, runId);
    assert.equal(counts.author, 1);
    assert.equal(counts.reviewer, 0, "the free gate must refuse before the panel spends");

    // The audit event carries the criteria names — the operator's only
    // diagnosable record of what the plan promised that nobody approved.
    const audited = auditSummaries(store, runId, "plan.coverage.unkeepable");
    assert.equal(audited.length, 1);
    assert.match(audited[0], /AC-001/);

    assert.equal(store.getStageChain(runId).find((s) => s.kind === "plan")!.status, "blocked");
    assert.equal(store.getRun(runId)!.status, "blocked");
    assert.equal(verifyAuditChain(store), null);
  });
});

// --- terminal review paths ---------------------------------------------------

test("a reviewer returning a non-proposed status blocks rather than passing by absence", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-reviewer-blocked.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        'summary: "fixture plan review",',
        'summary: "fixture plan review", status: "blocked",'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /returned status blocked, not proposed/);
    assert.match(result.reason, /must not pass the gate by absence/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("an author returning an invalid plan document blocks terminally and writes no plan", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-invalid-plan.mjs");
    writeFileSync(
      scratch,
      // Drop the arrow so the coverage line matches neither documented form.
      fixtureSource().replace(
        ': `- ${id} -> ${index === 0 ? artifact : second}`',
        ': `- ${id} ${index === 0 ? artifact : second}`'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /coverage entry must be/);
    assert.equal(store.getStageChain(runId).find((s) => s.kind === "plan")!.status, "blocked");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("the seeded registry can staff the plan panel end to end", async () => {
  // Hazard 11: a default installation must be able to complete a run. The
  // panel-size refusal itself is proven by the selectPanel seam below: the
  // seeded registry seats more distinct specialties than the frozen floor
  // asks for, so no fixture can produce a short panel honestly.
  await withApprovedRun(async ({ store, root, runId }) => {
    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    assert.equal(agentRunCounts(store, runId).reviewer, 2, "one round, the author's requested two");
  });
});

test("an unstaffable panel blocks the plan_review stage by name", async () => {
  await withApprovedRun(
    async ({ store, root, runId }) => {
      // The seam returns no reviewers, which is the state a depleted registry
      // would produce. The guard must refuse by name before any reviewer is
      // dispatched. Risk is high here and no longer changes the expected
      // count — the frozen floor of two is what the refusal names.
      const result = await runPlanStage(
        store,
        fixtureExecutor(FIXTURE),
        { runId, rootDir: root },
        { selectPanel: () => [] }
      );
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /plan panel incomplete: needs 2 reviewers, found 0/);
      assert.equal(agentRunCounts(store, runId).reviewer, 0, "no reviewer was dispatched");
      assert.equal(store.getStageChain(runId).find((s) => s.kind === "plan_review")!.status, "blocked");
      assert.equal(store.getRun(runId)!.status, "blocked");
    },
    { spec: HIGH_SPEC, scope: HIGH_SCOPE, changeKind: "defect_fix" }
  );
});

test("a plan request too small for the configured required lenses blocks by name", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The spec stage carries the same assertion, and it has to exist twice:
    // these two orchestrators are duplicated on purpose, so nothing structural
    // notices a guard that was wired on one side and only tested on the other.
    const scratch = join(root, "emit-plan-clean.mjs");
    writeFileSync(scratch, fixtureSource().replace('stdin.includes("REVISED-plan")', "true"));
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, {
      panelSizeMax: 3,
      requiredSpecialties: ["requirements-traceability", "security", "consistency"],
    });
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(
      result.reason,
      /plan panel request refused: panel request of 2 cannot seat the 3 required and requested specialties: consistency, requirements-traceability, security/
    );
    assert.equal(agentRunCounts(store, runId).reviewer, 0, "no reviewer was dispatched");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a plan author asking for three seats staffs every required lens", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-plan-three-seats.mjs");
    writeFileSync(
      scratch,
      fixtureSource()
        .replace(
          'panelRequest: { size: 2, specialties: ["security"] },',
          'panelRequest: { size: 3, specialties: ["security"] },'
        )
        .replace('stdin.includes("REVISED-plan")', "true")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, {
      panelSizeMax: 3,
      requiredSpecialties: ["requirements-traceability", "security", "consistency"],
    });
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    assert.equal(agentRunCounts(store, runId).reviewer, 3, "one seat per required lens");
  });
});

test("the plan author's requested size is what sizes the panel", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The discriminating configuration: one required lens under a ceiling of
    // three, with the author asking for three. A stage that ignored the
    // request and seated the frozen floor instead would seat two here, so
    // this fails unless the request itself is what sizes the panel.
    const scratch = join(root, "emit-plan-three-requested.mjs");
    writeFileSync(
      scratch,
      fixtureSource()
        .replace(
          'panelRequest: { size: 2, specialties: ["security"] },',
          'panelRequest: { size: 3, specialties: ["security"] },'
        )
        .replace('stdin.includes("REVISED-plan")', "true")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, { panelSizeMax: 3 });
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    assert.equal(
      agentRunCounts(store, runId).reviewer,
      3,
      "the requested three, not the two the frozen floor would have staffed"
    );
  });
});

test("a plan request outside the frozen bounds blocks before the panel spends", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-plan-oversized-request.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        'panelRequest: { size: 2, specialties: ["security"] },',
        'panelRequest: { size: 3, specialties: ["security"] },'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /panel request size 3 is outside the frozen bounds 2-2/);
    assert.equal(agentRunCounts(store, runId).reviewer, 0, "no reviewer was dispatched");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a plan requesting a lens the frozen registry cannot seat blocks by name", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-plan-unstaffable-lens.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        'panelRequest: { size: 2, specialties: ["security"] },',
        'panelRequest: { size: 2, specialties: ["data-privacy"] },'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /plan panel cannot be staffed/);
    assert.match(result.reason, /no reviewer for requested specialty data-privacy/);
    assert.match(result.reason, /the registry seats consistency, requirements-traceability, security/);
    assert.equal(agentRunCounts(store, runId).reviewer, 0, "no reviewer was dispatched");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("the plan panel seats the lens the author asked for", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The request names `security`; the ranked fill would otherwise take
    // `consistency` first. Asserting the seated ids is what distinguishes a
    // request that was honoured from one that was validated and discarded.
    const scratch = join(root, "emit-plan-lens-check.mjs");
    writeFileSync(scratch, fixtureSource().replace('stdin.includes("REVISED-plan")', "true"));
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const seated = store
      .query<{ agent: string }>(
        "SELECT DISTINCT ar.agent FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? AND ar.role = 'reviewer' ORDER BY ar.agent",
        [runId]
      )
      .map((r) => r.agent);
    assert.deepEqual(seated, ["spec-reviewer-security", "spec-reviewer-traceability"]);
  });
});

test("a reconciliation with missing, unknown, and duplicate coverage IDs blocks and leaves the gated plan on disk", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The reconciliation variant drops AC-003, repeats AC-002, and invents
    // AC-999. The identity gate must run on the reconciled plan exactly as on the
    // first write, and it must refuse *before* the reconciliation overwrites
    // the document the gate already approved.
    const scratch = join(root, "emit-dropped-criterion-revision.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        "const ids = criterionIds();",
        'const ids = stdin.includes("reconcile") ? [...criterionIds().slice(0, 2), "AC-002", "AC-999"] : criterionIds();'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(
      result.reason,
      "plan coverage IDs are invalid: missing=[AC-003]; unknown=[AC-999]; duplicate=[AC-002]"
    );

    // The refusal happened before the write: the gated round-1 document is
    // still the file on disk, not the never-approved revision.
    const onDisk = readFileSync(join(root, "docs", "features", SLUG, "plan.md"), "utf8");
    assert.ok(!onDisk.includes("REVISED-plan"), "the refused revision must not replace the gated plan");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("an unexpected throw mid-review lands in the terminal machinery", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // Force a throw between the stage insert and the completion. The wedge
    // guard must produce the same terminal state as any named failure: the
    // pending review stage blocks, the run blocks, and the audit chain stays
    // intact — no run left wedged in_progress.
    const original = store.upsertCanonicalFinding;
    store.upsertCanonicalFinding = () => {
      throw new Error("boom");
    };
    try {
      const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /plan stage failed: boom/);
      const chain = store.getStageChain(runId);
      assert.equal(chain.find((s) => s.kind === "plan_review")!.status, "blocked");
      assert.equal(store.getRun(runId)!.status, "blocked");
      const audited = auditSummaries(store, runId, "plan.stage.failed");
      assert.equal(audited.length, 1);
      assert.match(audited[0], /plan stage failed: boom/);
      assert.equal(verifyAuditChain(store), null);
    } finally {
      store.upsertCanonicalFinding = original;
    }
  });
});

test("a profile tampered with since intake is refused before any dispatch", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The frozen profile is what makes the model map binding. Reading it
    // without comparing its hash to run.profile_ref means the map is
    // enforced but not tamper-evident: editing the file on disk changes
    // which model the run may use, and nothing objects.
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as { modelMap: Record<string, string> };
    profile.modelMap.plan = "tampered-model";
    writeFileSync(path, canonicalJson(profile));
    // run.profile_ref is deliberately NOT updated — that is the tampering.

    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /profile for run \d+ has been modified since intake: frozen [0-9a-f]{64}, on disk [0-9a-f]{64}/);
    assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
  });
});

test("a profile with no plan_review model fails at configuration time", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The review panel is a different stage kind. If the stage reused the
    // author's model, this entry would never be consulted here — while
    // `bw dispatch`, which resolves by stage.kind, would enforce it. The two
    // surfaces must not disagree about the same stage.
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as { modelMap: Record<string, string> };
    delete profile.modelMap.plan_review;
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));

    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /no model configured for stage plan_review/);
    assert.equal(agentRunCounts(store, runId).author, 0, "the failure precedes the invocation");
  });
});

test("an executor without the plan capability is refused before the stage row", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const noPlan = {
      ...fixtureExecutor(FIXTURE),
      capabilities: fixtureExecutor(FIXTURE).capabilities.filter((c) => c !== "plan"),
    };
    freezeExecutorIntoProfile(store, root, runId, noPlan);
    const result = await runPlanStage(store, noPlan, { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /lacks the required capability "plan" for stage kind plan/);
    assert.equal(agentRunCounts(store, runId).author, 0, "the failure precedes the invocation");
  });
});

test("a plan covering only some acceptance criteria blocks before the panel", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The scope gate answers "may the plan promise this artifact". It does
    // not answer "did the plan promise anything for this criterion at all" —
    // a plan covering one of three criteria satisfies scope perfectly.
    const scratch = join(root, "emit-partial-coverage.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace("const ids = criterionIds();", "const ids = criterionIds().slice(0, 1);")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /plan coverage IDs are invalid/);
    assert.match(result.reason, /missing=\[AC-002, AC-003\]/);

    // Deterministic and free, so it must refuse before the panel spends.
    const counts = agentRunCounts(store, runId);
    assert.equal(counts.author, 1);
    assert.equal(counts.reviewer, 0, "the free gate must refuse before the panel spends");

    const audited = auditSummaries(store, runId, "plan.coverage.invalid");
    assert.equal(audited.length, 1);
    assert.match(audited[0], /missing=\[AC-002, AC-003\]/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("coverage identity diagnostics group missing, unknown, and duplicate IDs before scope", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-invalid-coverage-ids.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        "const ids = criterionIds();",
        'const ids = [...criterionIds().slice(0, 2), "AC-002", "AC-999"];'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(
      result.reason,
      "plan coverage IDs are invalid: missing=[AC-003]; unknown=[AC-999]; duplicate=[AC-002]"
    );
    assert.equal(agentRunCounts(store, runId).reviewer, 0);
    assert.deepEqual(auditSummaries(store, runId, "plan.coverage.invalid"), [result.reason]);
    assert.equal(auditSummaries(store, runId, "plan.coverage.unkeepable").length, 0);
  });
});

test("a clean panel round produces zero decisions and the gate passes with no reconciliation revision", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-plan-clean-default.mjs");
    writeFileSync(scratch, fixtureSource().replace('stdin.includes("REVISED-plan")', "true"));
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const counts = agentRunCounts(store, runId);
    // Draft, self-critique, and one reconciliation — the phase order runs a
    // reconciliation per round even when the panel reported nothing, so the
    // reconciler is the actor that confirms an empty findings set.
    assert.equal(counts.author, 3, "draft and self-critique plus one reconciliation");
    assert.equal(counts.reviewer, 2, "the author asked for two");
    assert.match(auditSummaries(store, runId, "plan.gate.pass")[0], /gate passed after 1 round\(s\)/);
  });
});

// --- self-critique -----------------------------------------------------------

test("exactly one self-critique runs per plan, and the panel reviews its output", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // A clean panel, so the gate passes in round one and the document it
    // approved is the one self-critique produced.
    const scratch = join(root, "emit-plan-clean-critique.mjs");
    writeFileSync(scratch, fixtureSource().replace('stdin.includes("REVISED-plan")', "true"));
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    if (!result.ok) return;
    const recorded = auditSummaries(store, runId, "plan.selfcritique.record");
    assert.equal(recorded.length, 1, "one self-critique per artifact");
    assert.match(recorded[0], /1 critique entries; panel request size 2, specialties \[security\]/);
    const onDisk = readFileSync(result.planPath, "utf8");
    assert.ok(onDisk.includes("SELFCRITIQUED"), "the self-critiqued plan is what was written and gated");
    // The panel is still the frozen floor: the request is validated and
    // retained, and staffing against it is Task 5's.
    assert.equal(agentRunCounts(store, runId).reviewer, 2);
  });
});

test("a self-critique with missing, unknown, and duplicate coverage IDs blocks and leaves the gated draft on disk", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // Every gate the draft passed runs again on the revised plan, and refuses
    // before the revision can replace the document already on disk.
    const scratch = join(root, "emit-plan-critique-drops-criterion.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        "const ids = criterionIds();",
        'const ids = stdin.includes("self-critique") ? [...criterionIds().slice(0, 2), "AC-002", "AC-999"] : criterionIds();'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(
      result.reason,
      "plan coverage IDs are invalid: missing=[AC-003]; unknown=[AC-999]; duplicate=[AC-002]"
    );
    const onDisk = readFileSync(join(root, "docs", "features", SLUG, "plan.md"), "utf8");
    assert.ok(!onDisk.includes("SELFCRITIQUED"), "the refused revision must not replace the draft");
    assert.equal(agentRunCounts(store, runId).reviewer, 0, "the free gate refuses before the panel spends");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a self-critique with an empty critique blocks before the panel", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-plan-empty-critique.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace('critique: ["the tasks do not say what proves them"],', "critique: [],")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /plan self-critique refused: self-critique critique must be a non-empty array/);
    assert.equal(agentRunCounts(store, runId).reviewer, 0);
    assert.equal(store.getStageChain(runId).find((s) => s.kind === "plan")!.status, "blocked");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("an author whose frozen definition cannot self-critique blocks before the dispatch", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as {
      agents: { id: string; outputs: string[] }[];
    };
    const author = profile.agents.find((a) => a.id === "plan-author")!;
    author.outputs = author.outputs.filter((o) => o !== "plan-self-critique");
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));

    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /does not allow plan-self-critique output/);
    // The refusal precedes every dispatch: a run that cannot complete this
    // stage must not pay for a draft first.
    assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("the self-critique prompt names the specialties the frozen registry can seat", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The spec stage has the same assertion, and it has to exist twice: the
    // builder's own test proves the list renders when it is passed, and only
    // a stage test proves the stage passes it. Revision A of the Task 1
    // prototype binds both sides — an author not told what the registry seats
    // requests a lens nobody can staff, which turns Task 5's named staffing
    // refusal into the ordinary outcome at the cost of a panel per run.
    const scratch = join(root, "emit-plan-registry-echo.mjs");
    writeFileSync(
      scratch,
      fixtureSource()
        .replace(
          'panelRequest: { size: 2, specialties: ["security"] },',
          "panelRequest: { size: 2, specialties: [registeredLens()] },"
        )
        .replace(
          "function planDoc({",
          `function registeredLens() {
  const block = stdin.split("registered specialties:")[1] ?? "";
  const listed = block.split("A specialty outside")[0] ?? "";
  const lenses = listed
    .split("- ")
    .slice(1)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return lenses[0] ?? "none-listed";
}

function planDoc({`
        )
        .replace('stdin.includes("REVISED-plan")', "true")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const recorded = auditSummaries(store, runId, "plan.selfcritique.record")[0]!;
    const named = /specialties \[([a-z-]*)\]/.exec(recorded)![1];
    assert.notEqual(named, "none-listed", "the prompt listed no registered specialty at all");
    const seatable = AGENTS.filter((a) => a.role === "reviewer" && a.outputs.includes("findings")).map(
      (a) => a.specialty
    );
    assert.ok(seatable.includes(named), `${named} is not a specialty the registry seats`);
  });
});

// --- reconciliation ------------------------------------------------------------

test("an author whose frozen definition cannot reconcile blocks before the dispatch", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The plan-side copy of the spec-side assertion, and it has to exist
    // twice: the two orchestrators are duplicated on purpose, so nothing
    // structural notices a capability checked on one side and only tested on
    // the other.
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as {
      agents: { id: string; outputs: string[] }[];
    };
    const author = profile.agents.find((a) => a.id === "plan-author")!;
    author.outputs = author.outputs.filter((o) => o !== "plan-reconciliation");
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));

    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /does not allow plan-reconciliation output/);
    assert.equal(agentRunCounts(store, runId).author, 0, "nothing was spent");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a reconciliation whose plan does not validate blocks instead of overwriting the gated plan", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-plan-invalid-reconcile.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        "proposedContentChanges: { plan: artifact, decisions },",
        'proposedContentChanges: { plan: "not a plan", decisions },'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /plan reconciliation document refused/);
    const onDisk = readFileSync(join(root, "docs", "features", SLUG, "plan.md"), "utf8");
    assert.ok(!onDisk.includes("not a plan"));
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a reconciliation missing a decision for a reported finding blocks by name", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-plan-missing-decision.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace("const decisions = ids.map((id, index) => ({", "const decisions = ids.slice(1).map((id, index) => ({")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /plan reconciliation refused: reconciliation is incomplete: no decision for canonical finding id\(s\)/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("mixed reports reach the plan reconciler unfused: a shared identity dedups, a classification split stays two findings", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The plan-side copy of the spec-side mixed-pair proof: one shared
    // identity with two reports, one classification split across two
    // canonical findings, and no fused severity/classification pair.
    const scratch = join(root, "emit-plan-mixed-pair.mjs");
    const source = fixtureSource()
      .replace(
        `  const findings = stdin.includes("REVISED-plan")
    ? []
    : [
        {
          location: criterionIds()[0] ?? "## Coverage",
          intentKey: "coverage-gap",
          severity: "high",
          classification: "current_artifact",
          subject: "a criterion has no convincing coverage",
        },
        {
          location: "## Tasks",
          intentKey: "nit-pick",
          severity: "low",
          classification: "current_artifact",
          subject: "tasks could be ordered better",
        },
      ];`,
        `  const findings =
    agentId === "spec-reviewer-security"
      ? [
          {
            location: "AC-001",
            intentKey: "shared-concern",
            severity: "critical",
            classification: "current_artifact",
            subject: "severe in-artifact concern",
          },
          {
            location: "## Tasks",
            intentKey: "dup-concern",
            severity: "critical",
            classification: "current_artifact",
            subject: "the same concern twice",
          },
        ]
      : [
          {
            location: "upstream:specification:shared-concern",
            intentKey: "shared-concern",
            severity: "low",
            classification: "upstream",
            subject: "mild upstream concern",
          },
          {
            location: "## Tasks",
            intentKey: "dup-concern",
            severity: "low",
            classification: "current_artifact",
            subject: "the same concern twice",
          },
        ];`
      )
      .replace(
        `  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["## Tasks"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "## Tasks",
              artifactText: "Build the thing REVISED-plan",
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
            {
              artifactLocation: "## Tasks",
              artifactText: supersededTask(current),
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
          ]
        : [],
  }));
  emit({
    status: "proposed",
    agent: "plan-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture reconcile",
    proposedContentChanges: { plan: artifact, decisions },
  });
}`,
        `  const decisions = ids.map((id) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["## Tasks"],
  }));
  emit({
    status: "proposed",
    agent: "plan-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture reconcile",
    proposedContentChanges: { plan: current, decisions },
  });
}`
      );
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const reviewStage = store.getStageChain(runId).find((s) => s.kind === "plan_review")!;
    const findings = store.getCanonicalFindings(reviewStage.id);
    assert.equal(findings.length, 3, "dup-concern dedups; shared-concern splits by classification");
    const dup = findings.find((f) => f.intent_key === "dup-concern")!;
    const sharedCurrent = findings.find(
      (f) => f.intent_key === "shared-concern" && f.location === "AC-001"
    )!;
    const sharedUpstream = findings.find(
      (f) => f.intent_key === "shared-concern" && f.location === "upstream:specification:shared-concern"
    )!;
    assert.ok(dup && sharedCurrent && sharedUpstream);
    assert.equal(store.getFindingReports(dup.id).length, 2, "both reviewers' reports on the shared identity survive");
    const dupSeverities = store.getFindingReports(dup.id).map((r) => r.severity).sort();
    assert.deepEqual(dupSeverities, ["critical", "low"], "neither report's own severity was fused or dropped");
    assert.equal(store.getFindingReports(sharedCurrent.id).length, 1);
    assert.equal(store.getFindingReports(sharedCurrent.id)[0].classification, "current_artifact");
    assert.equal(store.getFindingReports(sharedUpstream.id).length, 1);
    assert.equal(store.getFindingReports(sharedUpstream.id)[0].classification, "upstream");
  });
});

test("the plan reconciliation prompt carries the approved specification", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The reconciler's answer embeds what it saw: the fixture echoes whether
    // the approved spec's frontmatter reached it into the decision's
    // changedLocations. `change_kind` appears only in the specification, not
    // in the plan, so the echo discriminates the two documents.
    const scratch = join(root, "emit-plan-reconcile-spec.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        'changedLocations: ["## Tasks"],',
        'changedLocations: [stdin.includes("change_kind: feature") ? "spec-seen" : "spec-missing"],'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const records = auditSummaries(store, runId, "plan.reconcile.record");
    assert.ok(records[0].includes("spec-seen"), "the reconciler saw the approved specification");
  });
});
