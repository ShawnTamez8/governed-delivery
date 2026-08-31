import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { runPlanStage } from "../src/plan-stage.ts";
import { freezeProfile } from "../src/profile.ts";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { REMEDIATION_ROUNDS } from "../src/policy.ts";
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

- the thing works
- it is observable
- it stays working
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
        summary: `spec_review gate passed in round 1; specHash=${sha256Hex(normalizeText(spec))}; risk=low`,
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

// --- the success path -------------------------------------------------------

test("the happy path chains plan and plan_review from the approved stage", async () => {
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
    assert.ok(plan.includes("REVISED-plan"), "the revision round was written");
    assert.equal(verifyAuditChain(store), null);
    assert.equal(store.getRun(runId)!.status, "in_progress");
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
    // Pinned exactly, not matched as an alternation: risk is the panel-size
    // input, and a computeRisk or PANEL_SIZE regression must fail this test.
    assert.equal(
      summaries[0],
      `plan_review gate passed in round 2; planHash=${onDisk}; planFor=${specHash}; risk=low`
    );
    // Panel size is the count of distinct reviewers seated, not of dispatch
    // rows — a panel of one dispatches once per round.
    const distinctReviewers = store.query<{ n: number }>(
      "SELECT COUNT(DISTINCT ar.agent) AS n FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? AND ar.role = 'reviewer'",
      [runId]
    )[0].n;
    assert.equal(distinctReviewers, 1, "low risk seats a panel of one");
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
    writeFileSync(specPath, `${SPEC}\n- something nobody approved\n`);
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
        "proposedContentChanges: { plan: planDoc({ revised: stdin.includes(\"## Revision\") }) },",
        "proposedContentChanges: { plan: planDoc({ outOfScope: true }) },"
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /plan promises coverage outside the approved scope/);
    assert.match(result.reason, /the thing works/);

    // The gate is deterministic and free, so it must run before the panel:
    // one author invocation, zero reviewer invocations.
    const counts = agentRunCounts(store, runId);
    assert.equal(counts.author, 1);
    assert.equal(counts.reviewer, 0, "the free gate must refuse before the panel spends");

    // The audit event carries the criteria names — the operator's only
    // diagnosable record of what the plan promised that nobody approved.
    const audited = auditSummaries(store, runId, "plan.coverage.unkeepable");
    assert.equal(audited.length, 1);
    assert.match(audited[0], /the thing works/);

    assert.equal(store.getStageChain(runId).find((s) => s.kind === "plan")!.status, "blocked");
    assert.equal(store.getRun(runId)!.status, "blocked");
    assert.equal(verifyAuditChain(store), null);
  });
});

// --- terminal review paths ---------------------------------------------------

test("budget exhaustion blocks naming the still-open finding ids", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The reviewer never stops reporting, so no round can resolve the
    // finding and the closure budget runs out.
    const scratch = join(root, "emit-never-satisfied.mjs");
    writeFileSync(scratch, fixtureSource().replace('stdin.includes("REVISED-plan")', "false"));
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(
      result.reason,
      new RegExp(`material findings remain open after ${REMEDIATION_ROUNDS} rounds: \\d+`)
    );
    const reviewStage = store.getStageChain(runId).find((s) => s.kind === "plan_review")!;
    assert.equal(reviewStage.status, "blocked");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

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
      fixtureSource().replace("- the thing works -> ${artifact}", "- the thing works ${artifact}")
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
  // seeded registry staffs every risk level, so no fixture can produce a
  // short panel honestly.
  await withApprovedRun(async ({ store, root, runId }) => {
    const result = await runPlanStage(store, fixtureExecutor(FIXTURE), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    assert.ok(agentRunCounts(store, runId).reviewer >= 1, "at least one reviewer was seated");
  });
});

test("an unstaffable panel blocks the plan_review stage by name", async () => {
  await withApprovedRun(
    async ({ store, root, runId }) => {
      // A high-risk run needs three reviewers; the seam returns none, which is
      // the state a depleted registry would produce. The guard must refuse by
      // name before any reviewer is dispatched.
      const result = await runPlanStage(
        store,
        fixtureExecutor(FIXTURE),
        { runId, rootDir: root },
        { selectPanel: () => [] }
      );
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /plan panel incomplete: risk high needs 3 reviewers, found 0/);
      assert.equal(agentRunCounts(store, runId).reviewer, 0, "no reviewer was dispatched");
      assert.equal(store.getStageChain(runId).find((s) => s.kind === "plan_review")!.status, "blocked");
      assert.equal(store.getRun(runId)!.status, "blocked");
    },
    { spec: HIGH_SPEC, scope: HIGH_SCOPE, changeKind: "defect_fix" }
  );
});

test("a revision that drops a criterion's coverage blocks and leaves the gated plan on disk", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // The revision variant drops the "it stays working" line. The
    // completeness gate must run on revisions exactly as on the first write,
    // and it must refuse *before* the revision overwrites the document the
    // gate already approved.
    const scratch = join(root, "emit-dropped-criterion-revision.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        "- it stays working -> ${second}",
        '${stdin.includes("## Revision") ? "" : "- it stays working -> " + second}'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /does not cover every acceptance criterion/);
    assert.match(result.reason, /it stays working/);

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
    const original = store.insertFinding;
    store.insertFinding = () => {
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
      store.insertFinding = original;
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
      fixtureSource()
        .replace("- it is observable -> not_applicable: observed at runtime, not asserted / checked in the smoke run's recorded output\n", "")
        .replace("- it stays working -> ${second}\n", "")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runPlanStage(store, fixtureExecutor(scratch), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /does not cover every acceptance criterion/);
    assert.match(result.reason, /it is observable/);
    assert.match(result.reason, /it stays working/);

    // Deterministic and free, so it must refuse before the panel spends.
    const counts = agentRunCounts(store, runId);
    assert.equal(counts.author, 1);
    assert.equal(counts.reviewer, 0, "the free gate must refuse before the panel spends");

    const audited = auditSummaries(store, runId, "plan.coverage.incomplete");
    assert.equal(audited.length, 1);
    assert.match(audited[0], /it is observable/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});
