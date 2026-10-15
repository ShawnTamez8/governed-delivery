import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { runImplementationStage } from "../src/implementation-stage.ts";
import { freezeUniformProfile } from "./uniform-profile.ts";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { parseImplementationGate } from "../src/handoff.ts";
import { policyHash } from "../src/policy.ts";
import { deliveryCoverage } from "../src/delivery-coverage.ts";
import { PATCH_RESULT_SCHEMA, validateAgentResult } from "../src/agent-result.ts";
import { parseEnvelope, PROMPT_MAX_BYTES } from "../src/harness.ts";
import type { ExecutorDefinition } from "../src/executor.ts";
import type { VerificationConfig } from "../src/governed-config.ts";
import { IMPLEMENTER } from "../src/agents/implementer.ts";
import { buildImplementationAuthorPrompt, buildImplementationSelfReviewPrompt } from "../src/prompts.ts";
import { runVerificationStage } from "../src/verification-stage.ts";
import { planPhases, validatePlanDoc } from "../src/plan-doc.ts";

/**
 * One minimal frozen configuration. The stage states it to the implementer; the
 * command name and tokens must stay clear of the words the stage emitters route
 * on (test/prompts.test.ts guards this).
 */
const VERIFICATION: VerificationConfig = { commands: [{ name: "unit", command: ["node", "--version"] }] };
const FIXTURE = join(process.cwd(), "test", "fixtures", "harness", "emit-implementation-stage.mjs");
const MODEL = "m";
const SLUG = "demo";
const BASE_MARKER = "base-marker-content";

/**
 * The approved specification, matching `test/plan-stage.test.ts`'s shape.
 * Two declared artifacts on a feature run.
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

function fixtureExecutor(): ExecutorDefinition {
  return {
    // The fixture simulates the claude-code executor: the run's frozen
    // profile freezes this fixture (see withApprovedRun), so the stage's
    // binding checks see the fixture as the executor the run froze.
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
      envPassthrough: ["PATH", "SystemRoot", "TEMP", "TMP", "EMIT_MODE", "EMIT_PATH", "EMIT_FAIL_PHASE"],
      network: "inherit",
    },
  };
}

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * The harness passes named variables only, so an unset EMIT_MODE is
 * indistinguishable from the default mode. Tests that drive a mode set it
 * before the run and restore the previous value after.
 */
/** The fixture executor minus one capability — the capability regressions' setup. */
function fixtureExecutorWithout(capability: string): ExecutorDefinition {
  const executor = fixtureExecutor();
  return { ...executor, capabilities: executor.capabilities.filter((c) => c !== capability) };
}

/**
 * Freeze a profile whose executor is the fixture the tests hand. The
 * stage's binding checks compare the handed executor against the frozen
 * one canonically, so a test run must freeze exactly what it hands (the
 * profile-rewrite pattern of the config-time model test below).
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

async function withMode(
  fn: () => Promise<void>,
  mode: string,
  emitPath?: string,
  failPhase?: number
): Promise<void> {
  const beforeMode = process.env.EMIT_MODE;
  const beforePath = process.env.EMIT_PATH;
  const beforePhase = process.env.EMIT_FAIL_PHASE;
  process.env.EMIT_MODE = mode;
  if (emitPath !== undefined) process.env.EMIT_PATH = emitPath;
  if (failPhase !== undefined) process.env.EMIT_FAIL_PHASE = String(failPhase);
  try {
    await fn();
  } finally {
    if (beforeMode === undefined) delete process.env.EMIT_MODE;
    else process.env.EMIT_MODE = beforeMode;
    if (beforePath === undefined) delete process.env.EMIT_PATH;
    else process.env.EMIT_PATH = beforePath;
    if (beforePhase === undefined) delete process.env.EMIT_FAIL_PHASE;
    else process.env.EMIT_FAIL_PHASE = beforePhase;
  }
}

interface Ctx {
  store: Store;
  root: string;
  runId: number;
  head: string;
  specPath: string;
  planPath: string;
  specHash: string;
  planReviewStageId: number;
  worktreePath: string;
}

/**
 * A run parked exactly where the implementation stage expects it, in a real
 * git repository — `git worktree add` requires one, and the approval
 * requires a starting commit. Spec written and gated, approval recorded,
 * plan written and gated, `plan_review` passed. No dispatch anywhere: every
 * precondition must be reachable without spending.
 */
function withApprovedRun(
  fn: (ctx: Ctx) => Promise<void>,
  opts: {
    scope?: string[];
    approval?: boolean;
    spec?: string;
    gitignore?: string;
    /** The plan document, given the hash of the spec it must bind to. */
    plan?: (specHash: string) => string;
    /** The commands frozen into the run's profile; the stage states them to the implementer. */
    verification?: VerificationConfig;
    /** The committed base.txt, which the emitter embeds in every file it writes. */
    baseContent?: string;
  } = {}
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-implementation-"));
  const store = openStore(root);
  try {
    const init = git(root, ["init", "-q"]);
    assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
    writeFileSync(join(root, "base.txt"), opts.baseContent ?? BASE_MARKER);
    if (opts.gitignore !== undefined) {
      writeFileSync(join(root, ".gitignore"), opts.gitignore);
    }
    const addBase = git(root, ["add", "base.txt", ...(opts.gitignore !== undefined ? [".gitignore"] : [])]);
    assert.equal(addBase.status, 0, `git add failed: ${addBase.stderr}`);
    const commit = git(root, [
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "-m",
      "base",
    ]);
    assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
    const headResult = git(root, ["rev-parse", "HEAD"]);
    assert.equal(headResult.status, 0);
    const head = headResult.stdout.trim();
    assert.match(head, /^[0-9a-f]{40}([0-9a-f]{24})?$/, "HEAD must be a 40- or 64-hex commit");

    const spec = opts.spec ?? SPEC;
    const run = store.insertRun("p", "f-1", SLUG, "feature");
    const frozen = freezeUniformProfile(root, run.id, head, MODEL, opts.verification ?? VERIFICATION);
    store.setProfileRef(run.id, frozen.hash);
    // The run's frozen executor *is* the fixture: the stage refuses an
    // executor the profile never froze, and a test run is not exempt from
    // that contract — freeze exactly what the tests hand.
    freezeExecutorIntoProfile(store, root, run.id, fixtureExecutor());

    const specPath = join(root, "docs", "features", SLUG, "spec.md");
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(specPath, spec);
    const specHash = sha256Hex(normalizeText(spec));

    const specStage = store.insertStage(run.id, "spec", null);
    store.completeStage(specStage.id, specPath, "pass");
    const reviewStage = store.insertStage(run.id, "spec_review", specStage.id);
    store.completeStage(reviewStage.id, specPath, "pass");
    appendAudit(store, {
      runId: run.id,
      stageId: reviewStage.id,
      actor: "system",
      actorType: "cli",
      action: "spec.gate.pass",
      summary: `spec_review gate passed in round 1; specHash=${specHash}; risk=low`,
    });

    const approvalStage = store.insertStage(run.id, "awaiting_approval", reviewStage.id);
    store.completeStage(approvalStage.id, specPath, "pass");
    if (opts.approval !== false) {
      store.insertApproval({
        runId: run.id,
        featureId: "f-1",
        specHash,
        startingCommit: head,
        profileHash: frozen.hash,
        risk: "low",
        scope: canonicalJson(opts.scope ?? SCOPE),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        signature: "sig",
        signer: "signer",
      });
    }

    const planPath = join(root, "docs", "features", SLUG, "plan.md");
    const plan = opts.plan?.(specHash) ?? `feature: demo
plan_for: ${specHash}

## Tasks

- Build the thing
- Test the thing

## Coverage

- AC-001 -> src/a1.ts
- AC-002 -> not_applicable: observed at runtime, not asserted / checked in the smoke run's recorded output
- AC-003 -> test/a1.test.ts
`;
    mkdirSync(dirname(planPath), { recursive: true });
    writeFileSync(planPath, plan);
    const planStage = store.insertStage(run.id, "plan", approvalStage.id);
    store.completeStage(planStage.id, planPath, "pass");
    const planReviewStage = store.insertStage(run.id, "plan_review", planStage.id);
    store.completeStage(planReviewStage.id, planPath, "pass");
    appendAudit(store, {
      runId: run.id,
      stageId: planReviewStage.id,
      actor: "system",
      actorType: "cli",
      action: "plan.gate.pass",
      summary: `plan_review gate passed in round 1; planHash=${sha256Hex(normalizeText(plan))}; planFor=${specHash}; risk=low`,
    });

    return Promise.resolve(
      fn({
        store,
        root,
        runId: run.id,
        head,
        specPath,
        planPath,
        specHash,
        planReviewStageId: planReviewStage.id,
        worktreePath: join(root, ".governance", "worktrees", String(run.id)),
      })
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

function agentRunCount(store: Store, runId: number): number {
  return store.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ?",
    [runId]
  )[0].n;
}

// --- the success path -------------------------------------------------------

test("the success path: worktree, projections commit, applied patch, pass", async () => {
  await withApprovedRun(async ({ store, root, runId, head, planReviewStageId, worktreePath }) => {
    const before = git(root, ["status", "--porcelain"]);
    assert.equal(before.status, 0);

    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    if (!result.ok) return;

    const chain = store.getStageChain(runId);
    const stage = chain.find((s) => s.kind === "implementation")!;
    assert.equal(stage.status, "passed");
    assert.equal(stage.gate_result, "pass");
    assert.equal(stage.output_ref, worktreePath);
    assert.equal(stage.input_stage_id, planReviewStageId);

    const branch = git(root, ["rev-parse", "--verify", `gov/demo/${runId}`]);
    assert.equal(branch.status, 0, branch.stderr);

    // Exactly two run commits on the branch — the projections first, then
    // the applied patch. The range excludes the base commit the branch was
    // created from, which is the main repository's history, not the run's.
    const log = git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]);
    assert.equal(log.status, 0);
    const messages = log.stdout.trim().split("\n");
    const projectionsHash = git(worktreePath, ["rev-parse", "HEAD~1"]).stdout.trim();
    assert.deepEqual(messages, [
      `bw run ${runId}: apply patch (base ${projectionsHash.slice(0, 8)})`,
      `bw run ${runId}: projections (spec and plan)`,
    ]);
    // Run commits are authored as the system identity, never the operator.
    const author = git(worktreePath, ["log", "-1", "--format=%an|%ae"]);
    assert.equal(author.stdout.trim(), "BuildWorks|buildworks@buildworks.invalid");

    // Both scope files exist, and the applied content carries the base.txt
    // marker — the proof the harness ran with its cwd set to the worktree.
    assert.ok(existsSync(join(worktreePath, "src", "a1.ts")));
    assert.ok(existsSync(join(worktreePath, "test", "a1.test.ts")));
    const a1 = readFileSync(join(worktreePath, "src", "a1.ts"), "utf8");
    assert.ok(a1.includes(BASE_MARKER), "the applied content must carry the base.txt marker");

    const after = git(root, ["status", "--porcelain"]);
    assert.equal(after.stdout, before.stdout, "the main tree is untouched by the stage");

    assert.equal(verifyAuditChain(store), null);
    assert.equal(store.getRun(runId)!.status, "in_progress");
  });
});

test("the phase-1 implementer prompt carries the frozen profile's commands, and another config changes it", async () => {
  // `agent_run.input_hash` is the SHA-256 of the prompt sent. The prompt is
  // rebuilt from the run's own rows: the plan and spec on disk, the signed scope,
  // the handoff base the gate recorded, the first phase of the plan's tasks, and
  // no existing scope path (none of SCOPE exists at the base). If the hashes
  // differed for any reason but the commands, that is a finding, not a tolerance.
  const other: VerificationConfig = { commands: [{ name: "smoke", command: ["node", "--version"] }] };
  async function phaseOne(verification: VerificationConfig): Promise<{ sent: string; expected: string }> {
    let observed = { sent: "", expected: "" };
    await withApprovedRun(
      async ({ store, root, runId, specPath, planPath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        const rows = store.query<{ input_hash: string }>(
          "SELECT ar.input_hash FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? ORDER BY ar.id",
          [runId]
        );
        // One phase, then the self-review after it.
        assert.equal(rows.length, 2, "one phase dispatch and one self-review dispatch");
        const gate = store.query<{ summary: string }>(
          "SELECT summary FROM audit WHERE run_id = ? AND action = 'implementation.gate.pass' ORDER BY id DESC LIMIT 1",
          [runId]
        )[0]!;
        const handoff = parseImplementationGate(gate.summary);
        assert.ok(handoff.ok, handoff.ok ? "" : handoff.reason);
        const planText = readFileSync(planPath, "utf8");
        const plan = validatePlanDoc(planText);
        assert.ok(plan.ok, plan.ok ? "" : plan.reason);
        const prompt = buildImplementationAuthorPrompt(
          IMPLEMENTER,
          planText,
          readFileSync(specPath, "utf8"),
          SCOPE,
          handoff.value.base,
          planPhases(plan.value.taskItems, 10)[0]!,
          [],
          verification
        );
        observed = { sent: rows[0]!.input_hash, expected: sha256Hex(prompt) };
      },
      { verification }
    );
    return observed;
  }
  const recorded = await phaseOne(VERIFICATION);
  const changed = await phaseOne(other);
  assert.equal(recorded.sent, recorded.expected, "the stage sent the prompt built from the frozen commands");
  assert.equal(changed.sent, changed.expected);
  assert.notEqual(recorded.sent, changed.sent, "the implementer prompt follows the frozen config");
});

// --- preconditions, each refused by name before any state mutation ----------

test("a nonexistent run is refused by name", async () => {
  await withApprovedRun(async ({ store, root }) => {
    const result = await runImplementationStage(store, fixtureExecutor(), { runId: 9999, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /run 9999 does not exist/);
  });
});

test("a blocked run is refused before anything is created", async () => {
  await withApprovedRun(async ({ store, root, runId, worktreePath }) => {
    store.setRunStatus(runId, "blocked");
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /is blocked, not in_progress/);
    assert.equal(agentRunCount(store, runId), 0, "nothing was spent");
    assert.equal(existsSync(worktreePath), false);
  });
});

test("a second implementation stage is refused naming the existing stage's status", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const first = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(first.ok, true, (first as { reason?: string }).reason);
    const second = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.reason, /already has an implementation stage with status passed/);
  });
});

test("a run whose last stage is not a passed plan_review is refused", async () => {
  await withApprovedRun(async ({ store, root, runId, planReviewStageId }) => {
    store.insertStage(runId, "verification", planReviewStageId);
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /'s last stage is verification \(pending\), not a passed plan_review/);
    assert.equal(agentRunCount(store, runId), 0);
  });
});

test("a run with no approval is refused", async () => {
  await withApprovedRun(
    async ({ store, root, runId }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /has no recorded approval/);
      assert.equal(agentRunCount(store, runId), 0);
    },
    { approval: false }
  );
});

test("a deleted plan is refused naming the path", async () => {
  await withApprovedRun(async ({ store, root, runId, planPath }) => {
    rmSync(planPath);
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /cannot read the approved plan .*plan\.md/);
    assert.equal(agentRunCount(store, runId), 0);
  });
});

test("a plan edited after the gate is refused before any spend or worktree", async () => {
  await withApprovedRun(async ({ store, root, runId, planPath, worktreePath }) => {
    writeFileSync(planPath, readFileSync(planPath, "utf8") + "\n# edited after the gate\n");
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /the plan has changed since review: gated [0-9a-f]{64}, on disk [0-9a-f]{64}/);
    assert.equal(agentRunCount(store, runId), 0, "the spend boundary: nothing was dispatched");
    assert.equal(existsSync(worktreePath), false, "no worktree was created");
  });
});

test("a spec edited after approval is refused by name before any dispatch", async () => {
  await withApprovedRun(async ({ store, root, runId, specPath, worktreePath }) => {
    writeFileSync(specPath, readFileSync(specPath, "utf8") + "\n- src/extra.ts\n");
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /the spec has changed since approval: signed [0-9a-f]{64}, on disk [0-9a-f]{64}/);
    assert.equal(agentRunCount(store, runId), 0);
    assert.equal(existsSync(worktreePath), false);
  });
});

test("a spec whose signed hash was forged but whose planFor was not is refused by the plan binding", async () => {
  await withApprovedRun(async ({ store, root, runId, specPath, worktreePath }) => {
    // This variant proves the planFor comparison fires independently of the
    // approval comparison: the signed hash is forged to match the rewritten
    // spec, so only the gate event's planFor — still naming the original —
    // can refuse it.
    writeFileSync(specPath, readFileSync(specPath, "utf8") + "\n- src/extra.ts\n");
    const newSpecHash = sha256Hex(normalizeText(readFileSync(specPath, "utf8")));
    store.exec("UPDATE approval SET spec_hash = ? WHERE run_id = ?", [newSpecHash, runId]);
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(
      result.reason,
      /the spec does not match the plan the gate approved: planFor [0-9a-f]{64}, on disk [0-9a-f]{64}/
    );
    assert.equal(agentRunCount(store, runId), 0);
    assert.equal(existsSync(worktreePath), false);
  });
});

test("a run older than the duration limit is refused before the stage row exists", async () => {
  await withApprovedRun(async ({ store, root, runId, worktreePath }) => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86400_000).toISOString();
    store.exec("UPDATE run SET created_at = ? WHERE id = ?", [eightDaysAgo, runId]);
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /has exceeded the run-duration limit of 604800 seconds/);
    assert.equal(agentRunCount(store, runId), 0);
    assert.equal(existsSync(worktreePath), false);
    assert.ok(
      !store.getStageChain(runId).some((s) => s.kind === "implementation"),
      "no stage row was created"
    );
  });
});

test("a pre-existing worktree directory is refused naming the path", async () => {
  await withApprovedRun(async ({ store, root, runId, worktreePath }) => {
    mkdirSync(worktreePath, { recursive: true });
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /worktree path already exists for run \d+/);
    assert.equal(agentRunCount(store, runId), 0);
  });
});

// --- the gate: every refusal terminal, the worktree retained -----------------

/**
 * Drive one fixture mode and assert the full terminal shape: the stage
 * blocks, the run blocks, the reason names the cause, and the worktree
 * survives.
 */
async function expectGateRefusal(
  opts: { mode: string; emitPath?: string; scope?: string[] },
  expected: RegExp,
  extra?: (ctx: Ctx) => Promise<void>
): Promise<void> {
  await withMode(async () => {
    await withApprovedRun(async (ctx) => {
      const { store, root, runId, worktreePath } = ctx;
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, expected);
      const stage = store.getStageChain(runId).find((s) => s.kind === "implementation")!;
      assert.equal(stage.status, "blocked");
      assert.equal(stage.gate_result, "block");
      assert.equal(store.getRun(runId)!.status, "blocked");
      assert.equal(existsSync(worktreePath), true, "the worktree survives the block");
      if (extra) await extra(ctx);
    }, { scope: opts.scope });
  }, opts.mode, opts.emitPath);
}

test("a patch with a forged base commit is refused naming both hashes", () =>
  expectGateRefusal(
    { mode: "base-mismatch" },
    /patch base commit 0{40} does not match the branch head [0-9a-f]{40,64}/
  ));

test("an out-of-scope patch is refused naming the path", () =>
  expectGateRefusal({ mode: "out-of-scope" }, /outside the signed scope: src\/never-approved\.ts/));

test("a patch touching a protected path is refused naming it", () =>
  expectGateRefusal(
    { mode: "protected", scope: ["src/agents/evil.ts"] },
    /touches a protected path: src\/agents\/evil\.ts/
  ));

test("an empty delivery is refused naming the missing patches", () =>
  expectGateRefusal({ mode: "empty" }, /no proposed patches/));

test("a patch with no files remains an invalid-content event after patch-helper extraction", () =>
  expectGateRefusal({ mode: "empty-files" }, /patch with no files/, async ({ store, runId }) => {
    assert.equal(
      store.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM audit WHERE run_id = ? AND action = 'implementation.content.invalid'",
        [runId]
      )[0]!.n,
      1
    );
  }));

test("an add over an existing file is refused naming the rule", () =>
  expectGateRefusal(
    { mode: "add-existing", scope: ["docs/features/demo/spec.md"] },
    /add requires the file not to exist: docs\/features\/demo\/spec\.md/
  ));

test("a modify over a missing file is refused naming the rule", () =>
  expectGateRefusal(
    { mode: "modify-missing", scope: ["src/missing.ts"] },
    /modify requires the file to exist: src\/missing\.ts/
  ));

test("a patch path that escapes the repository is refused naming the escape", () =>
  expectGateRefusal(
    { mode: "protected", emitPath: "../evil.ts" },
    /path escapes the repository: \.\.\/evil\.ts/
  ));

test("a phase reply that never reached the structured channel is a failed dispatch, refused at the envelope", () =>
  expectGateRefusal(
    { mode: "not-json" },
    /^dispatched agent implementer \(author\) on stage \d+: envelope parse failed: harness envelope for executor claude-code has a result line without a structured_output object although the dispatch requested --json-schema: line \d+/,
    async ({ store, runId }) => {
      // A failed dispatch, not invalid content: no agent_run row, and the author action.
      assert.equal(agentRunCount(store, runId), 0);
      assert.equal(auditActionCount(store, runId, "implementation.author.failed"), 1);
      assert.equal(auditActionCount(store, runId, "implementation.content.invalid"), 0);
      // With no row, the audit event is where the reported cost survives; the
      // emitter's result line reports total_cost_usd 0. dispatchOnce appends the
      // requested model and effort after the refusal.
      assert.ok(
        auditSummaries(store, runId, "implementation.author.failed")[0]!.endsWith(
          "; the line reports total_cost_usd 0 (requested model m, effort medium)"
        ),
        auditSummaries(store, runId, "implementation.author.failed")[0]
      );
    }
  ));

test("a non-proposed implementer result is refused naming the status", () =>
  expectGateRefusal({ mode: "non-proposed" }, /implementer returned status failed, not proposed/));

test("a junction redirecting the write into a protected path is refused for the link, not the target", () =>
  expectGateRefusal(
    { mode: "symlink-dir", scope: ["src/alias/x.ts"] },
    /contains a link component: src\/alias/
  ));

test("a junction redirecting the write outside the worktree is refused for the link, not the escape", () =>
  expectGateRefusal(
    { mode: "escape-link", scope: ["src/escape/x.ts"] },
    /contains a link component: src\/escape/
  ));

test("a dangling link is refused by name because its target cannot be resolved", () =>
  expectGateRefusal(
    { mode: "dangling-link", scope: ["src/alias/x.ts"] },
    /contains a link component: src\/alias/
  ));

test("a link redirecting the write to an ordinary out-of-scope target is refused for the link, not the target", () =>
  expectGateRefusal(
    { mode: "link-ordinary", scope: ["src/alias/x.ts"] },
    /patch path src\/alias\/x\.ts contains a link component: src\/alias/
  ));

test("a file symlink redirecting the write into the run's design document is refused", async (t) => {
  // Pre-flight: Windows without Developer Mode refuses file symlinks for
  // unprivileged processes. The junction case above is the always-run proof
  // of the same guard; this single case skips with a recorded reason.
  const scratch = mkdtempSync(join(tmpdir(), "bw-filelink-"));
  let fileLinksWork = true;
  try {
    symlinkSync(join(scratch, "target.md"), join(scratch, "link.md"), "file");
  } catch {
    fileLinksWork = false;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (!fileLinksWork) {
    t.skip("file symlinks are refused by this OS (Windows without Developer Mode); the junction case covers the guard");
    return;
  }
  await expectGateRefusal(
    { mode: "symlink-design", scope: ["src/alias.md"] },
    /contains a link component: src\/alias\.md/
  );
});

test("an executor that mutates the worktree before returning a proposal is refused naming every path", async () => {
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, worktreePath, head }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.match(result.reason, /worktree is not clean after dispatch/);
        // All three residue classes are named: untracked, tracked, ignored
        // (asserted individually — git's entry order is not pinned).
        for (const entry of ["unreported.txt", "base.txt", "ignored-residue.txt"]) {
          assert.ok(result.reason.includes(entry), `the refusal must name ${entry}: ${result.reason}`);
        }
        const stage = store.getStageChain(runId).find((s) => s.kind === "implementation")!;
        assert.equal(stage.status, "blocked");
        assert.equal(stage.gate_result, "block");
        assert.equal(store.getRun(runId)!.status, "blocked");
        assert.equal(existsSync(worktreePath), true, "the worktree survives the block");
        assert.ok(existsSync(join(worktreePath, "unreported.txt")), "the untracked write is retained");
        assert.ok(existsSync(join(worktreePath, "ignored-residue.txt")), "the ignored write is retained");
        // Nothing was applied: only the projections commit exists, and no
        // patch-apply audit event was written.
        const applied = store.query<{ n: number }>(
          "SELECT COUNT(*) AS n FROM audit WHERE run_id = ? AND action = 'implementation.patch.apply'",
          [runId]
        )[0].n;
        assert.equal(applied, 0, "no patch was applied");
        const log = git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]);
        assert.equal(log.status, 0);
        assert.equal(
          log.stdout.trim().split("\n").filter((l) => l !== "").length,
          1,
          "the branch holds only the projections commit"
        );
      },
      { gitignore: "ignored-residue.txt" }
    );
  }, "mutate-then-propose");
});

test("an option-like patch path is refused alongside a dirty worktree before any git add", async () => {
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, worktreePath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, false);
        if (result.ok) return;
        // The cleanliness gate fires before any git add can see the "-A"
        // argument: the block is the ordering proof, and against the old
        // code `git add -A` committed the dirty file alongside "-A".
        assert.match(result.reason, /worktree is not clean after dispatch/);
        assert.ok(!existsSync(join(worktreePath, "-A")), "the patch was never applied");
        const stage = store.getStageChain(runId).find((s) => s.kind === "implementation")!;
        assert.equal(stage.status, "blocked");
      },
      { scope: ["-A"] }
    );
  }, "mutate-then-propose");
});

test("an option-like patch path is committed as a literal path", async () => {
  await withApprovedRun(async ({ store, root, runId, worktreePath }) => {
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    if (!result.ok) return;
    assert.ok(existsSync(join(worktreePath, "-A")), "the literal file exists");
    const changed = git(worktreePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD"]);
    assert.equal(changed.status, 0, changed.stderr);
    assert.deepEqual(
      changed.stdout.split("\0").filter((l) => l !== ""),
      ["-A"],
      "the commit holds exactly the literal path"
    );
  }, { scope: ["-A"] });
});

test("the stage's git add invocation stages exactly the literal paths", () => {
  // A contract pin for the git semantics the stage relies on: a bare "-A"
  // argument is the --all option and stages everything, while the literal
  // invocation — the global `--literal-pathspecs`, the `--` terminator, and
  // the paths — stages exactly what it names. The stage-level ordering guard
  // is the dirty-worktree test above; this pins the invocation itself.
  const scratch = mkdtempSync(join(tmpdir(), "bw-literal-paths-"));
  try {
    const init = git(scratch, ["init", "-q"]);
    assert.equal(init.status, 0, init.stderr);
    const base = git(scratch, ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base"]);
    assert.equal(base.status, 0, base.stderr);
    writeFileSync(join(scratch, "-A"), "a");
    writeFileSync(join(scratch, "other.txt"), "b");
    writeFileSync(join(scratch, "unreported.txt"), "c");
    const add = git(scratch, ["--literal-pathspecs", "add", "--", "-A", "other.txt"]);
    assert.equal(add.status, 0, add.stderr);
    const staged = git(scratch, ["diff", "--cached", "--name-only", "-z"]);
    assert.equal(staged.status, 0, staged.stderr);
    assert.deepEqual(
      staged.stdout.split("\0").filter((l) => l !== "").sort(),
      ["-A", "other.txt"],
      "exactly the literal paths are staged, nothing else"
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("a second patch touching a path the first applied is refused by the head-moved re-validation", async () => {
  await withMode(async () => {
    await withApprovedRun(async (ctx) => {
      const { store, root, runId, worktreePath } = ctx;
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /branch moved since proposal in: src\/a1\.ts/);
      const stage = store.getStageChain(runId).find((s) => s.kind === "implementation")!;
      assert.equal(stage.status, "blocked");
      assert.equal(store.getRun(runId)!.status, "blocked");
      assert.equal(existsSync(worktreePath), true);
      // Projections plus the first applied patch: the second patch was never
      // committed (the range excludes the base commit the branch was created
      // from).
      const log = git(worktreePath, ["log", "--oneline", `${ctx.head}..HEAD`]);
      assert.equal(log.status, 0);
      assert.equal(log.stdout.trim().split("\n").filter((l) => l !== "").length, 2);
    });
  }, "two-patches");
});

// --- config-time failure and the fixture contract ----------------------------

test("a profile with no implementer settings fails at configuration time, before dispatch", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as { dispatchSettings: Record<string, unknown> };
    delete profile.dispatchSettings["implementer"];
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));

    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /dispatchSettings carries no entry for implementer/);
    assert.equal(agentRunCount(store, runId), 0, "the failure precedes the invocation");
  });
});

test("the implementer dispatch records the frozen effort and its setting", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    // A value the seeded default never produces, so a stage that ignored the
    // frozen entry and used any default would write a different row.
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as {
      dispatchSettings: Record<string, { model: string; effort: string }>;
    };
    profile.dispatchSettings["implementer"] = { model: MODEL, effort: "xhigh" };
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));

    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const rows = store.query<{ setting: string; requested_effort: string; requested_model: string }>(
      "SELECT ar.setting, ar.requested_effort, ar.requested_model FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ?",
      [runId]
    );
    assert.deepEqual(
      rows.map((r) => ({ ...r })),
      // The phase and the self-review after it both run under the implementer setting.
      [
        { setting: "implementer", requested_effort: "xhigh", requested_model: MODEL },
        { setting: "implementer", requested_effort: "xhigh", requested_model: MODEL },
      ]
    );
  });
});

test("a handed executor that differs from the frozen profile executor is refused before the stage row", async () => {
  await withApprovedRun(async ({ store, root, runId, worktreePath }) => {
    // Same id, deep-different definition: id equality alone must not bind.
    const different = fixtureExecutor();
    different.sandbox.idleTimeoutSeconds = 999;
    const result = await runImplementationStage(store, different, { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /does not match the executor frozen at run start/);
    assert.equal(agentRunCount(store, runId), 0, "nothing was spent");
    assert.equal(existsSync(worktreePath), false, "no worktree was created");
    assert.ok(
      !store.getStageChain(runId).some((s) => s.kind === "implementation"),
      "no stage row was created"
    );
  });
});

test("an executor without the implementation capability is refused before the stage row", async () => {
  await withApprovedRun(async ({ store, root, runId, worktreePath }) => {
    const noImplementation = fixtureExecutorWithout("implementation");
    freezeExecutorIntoProfile(store, root, runId, noImplementation);
    const result = await runImplementationStage(store, noImplementation, { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(
      result.reason,
      /lacks the required capability "implementation" for stage kind implementation/
    );
    assert.equal(agentRunCount(store, runId), 0, "nothing was spent");
    assert.equal(existsSync(worktreePath), false, "no worktree was created");
  });
});

test("the ok fixture body passes the same contract real output is held to", () => {
  // Hazard 4: the shared fixture is validated against the same validator
  // real output is held to, so a fixture that drifted from the contract
  // fails here rather than agreeing with a stage that is also wrong.
  const scratch = mkdtempSync(join(tmpdir(), "bw-fixture-contract-"));
  try {
    writeFileSync(join(scratch, "base.txt"), BASE_MARKER);
    const prompt = [
      "This is phase 1 of 1.",
      `baseCommit must be exactly: ${"a".repeat(40)}`,
      "",
      "Patch only these paths:",
      "",
      "- src/a.ts",
      "",
      "",
    ].join("\n");
    const env = { ...process.env };
    delete env.EMIT_MODE;
    // The phase dispatch sends the patch schema, and its answer is read from structured_output.
    const run = spawnSync("node", [FIXTURE, "--json-schema", JSON.stringify(PATCH_RESULT_SCHEMA)], {
      cwd: scratch, input: prompt, encoding: "utf8", env,
    });
    assert.equal(run.status, 0, run.stderr);
    const envelope = parseEnvelope(fixtureExecutor(), run.stdout, true);
    const body = JSON.parse(envelope.resultText) as unknown;
    const verdict = validateAgentResult("implementer", body);
    assert.equal(verdict.ok, true, verdict.ok ? "" : verdict.reason);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("the gate event records the handoff: the projections commit as base, the applied head as head", async () => {
  // Step 8 task 2: the `implementation.gate.pass` event carries both commits
  // in the one canonical shape — the base the patches bound to (the head
  // after the projections commit, before any apply) and the final head.
  // Delivery diffs `base..head` for the changed paths, so a wrong base here
  // would silently re-admit or exclude whole sets of changes.
  await withApprovedRun(async ({ store, root, runId, head, worktreePath }) => {
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    if (!result.ok) return;
    const event = store
      .query<{ summary: string }>(
        "SELECT summary FROM audit WHERE run_id = ? AND action = 'implementation.gate.pass' ORDER BY id DESC LIMIT 1",
        [runId]
      )[0]!;
    const parsed = parseImplementationGate(event.summary);
    assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.reason);
    if (!parsed.ok) return;
    const final = git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();
    const projections = git(worktreePath, ["rev-parse", "HEAD~1"]).stdout.trim();
    assert.equal(parsed.value.head, final, "head is the branch tip after the applied patch");
    assert.equal(
      parsed.value.base,
      projections,
      "base is the post-projection commit the patches bound to"
    );
    assert.notEqual(parsed.value.base, head, "the base is never the starting commit: projections precede it");
  });
});

// --- phases: one dispatch per slice of the plan's tasks (hazard 20) ----------

/**
 * The plan team-notes run 6 produced, verbatim, with only its `plan_for` line
 * rewritten to the test spec's hash (the recorded hash names run 6's own spec).
 * Every task line is the recorded one: 57 of them.
 */
const RUN_6 = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "plan-team-notes-run-6.json"), "utf8")
) as { planMarkdown: string };

function run6Plan(specHash: string): string {
  return RUN_6.planMarkdown.replace(/^plan_for:.*$/m, `plan_for: ${specHash}`);
}

/** A valid plan with `count` tasks, for the boundary and frozen-ceiling tests. */
function tasksPlan(count: number): (specHash: string) => string {
  return (specHash) =>
    `feature: demo\nplan_for: ${specHash}\n\n## Tasks\n\n${Array.from({ length: count }, (_, i) => `- Task ${i + 1}`).join("\n")}\n\n## Coverage\n\n- AC-001 -> src/a1.ts\n`;
}

/**
 * A valid plan with `items` top-level tasks, each followed by `nested` indented
 * detail lines: the shape team-notes run 12's plan had (53 items, 173 nested lines).
 */
function nestedTasksPlan(items: number, nested: number): (specHash: string) => string {
  return (specHash) => {
    const tasks = Array.from({ length: items }, (_, i) =>
      [`- Task ${i + 1}:`, ...Array.from({ length: nested }, (_, j) => `  - detail ${i + 1}.${j + 1}`)].join("\n")
    ).join("\n");
    return `feature: demo\nplan_for: ${specHash}\n\n## Tasks\n\n${tasks}\n\n## Coverage\n\n- AC-001 -> src/a1.ts\n`;
  };
}

/** One scope path per phase, which the `phased` fixture modes add one at a time. */
function phaseScope(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `src/p${i + 1}.ts`);
}

function auditActionCount(store: Store, runId: number, action: string): number {
  return store.query<{ n: number }>("SELECT COUNT(*) AS n FROM audit WHERE run_id = ? AND action = ?", [
    runId,
    action,
  ])[0]!.n;
}

/** Rewrite the frozen policy the way a run frozen with other numbers would carry it. */
function freezePolicyValues(store: Store, root: string, runId: number, values: Record<string, number>): void {
  const path = join(root, ".governance", "profiles", String(runId), "profile.json");
  const profile = JSON.parse(readFileSync(path, "utf8")) as {
    policy: Record<string, unknown>;
    policyHash: string;
  };
  Object.assign(profile.policy, values);
  // loadVerifiedProfile requires the recorded hash to describe the policy it carries.
  profile.policyHash = policyHash(profile.policy as unknown as Parameters<typeof policyHash>[0]);
  const serialized = canonicalJson(profile);
  writeFileSync(path, serialized);
  store.setProfileRef(runId, sha256Hex(serialized));
}

test("the 57-task plan team-notes run 6 produced is implemented in six phases, one dispatch and one commit each", async () => {
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, head, worktreePath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        if (!result.ok) return;

        // Seven dispatches, each by the implementer setting, each with its own
        // prompt: five full phases, the remainder, and the self-review after them.
        assert.equal(agentRunCount(store, runId), 7);
        const rows = store.query<{ setting: string; input_hash: string }>(
          "SELECT ar.setting, ar.input_hash FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? ORDER BY ar.id",
          [runId]
        );
        assert.deepEqual([...new Set(rows.map((r) => r.setting))], ["implementer"]);
        assert.equal(new Set(rows.map((r) => r.input_hash)).size, 7, "each phase and the self-review sent a different prompt");

        const events = store
          .query<{ summary: string }>(
            "SELECT summary FROM audit WHERE run_id = ? AND action = 'implementation.phase.apply' ORDER BY id",
            [runId]
          )
          .map((e) => e.summary);
        assert.equal(events.length, 6);
        assert.match(events[0]!, /^phase 1 of 6: tasks 1-10; base=[0-9a-f]{40,64}; head=[0-9a-f]{40,64}$/);
        assert.match(events[5]!, /^phase 6 of 6: tasks 51-57; /);

        // The projections commit, then one commit per phase, newest first.
        const log = git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]);
        const messages = log.stdout.trim().split("\n");
        assert.equal(messages.length, 7);
        assert.match(messages[0]!, new RegExp(`^bw run ${runId}: phase 6/6 \\(base [0-9a-f]{8}\\)$`));
        assert.match(messages[5]!, new RegExp(`^bw run ${runId}: phase 1/6 \\(base [0-9a-f]{8}\\)$`));
        assert.equal(messages[6], `bw run ${runId}: projections (spec and plan)`);

        // Each phase proposed against the head the previous phase committed.
        const heads = events.map((e) => /head=([0-9a-f]+)$/.exec(e)![1]!);
        const bases = events.map((e) => /base=([0-9a-f]+);/.exec(e)![1]!);
        assert.deepEqual(bases.slice(1), heads.slice(0, -1), "phase k+1 starts where phase k ended");

        // The one handoff: the base is the head before phase 1, the head is the tip.
        const gate = store.query<{ summary: string }>(
          "SELECT summary FROM audit WHERE run_id = ? AND action = 'implementation.gate.pass'",
          [runId]
        );
        assert.equal(gate.length, 1, "the gate event is written once, after the last phase");
        const parsed = parseImplementationGate(gate[0]!.summary);
        assert.equal(parsed.ok, true);
        if (!parsed.ok) return;
        assert.equal(parsed.value.base, bases[0]);
        assert.equal(parsed.value.head, git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim());

        // Delivery's range holds exactly the union of the phases' paths.
        const changed = git(worktreePath, ["diff", "--name-only", `${parsed.value.base}..${parsed.value.head}`]);
        assert.deepEqual(changed.stdout.trim().split("\n").sort(), phaseScope(6));
        assert.equal(store.getRun(runId)!.status, "in_progress");
        assert.equal(verifyAuditChain(store), null);
      },
      { plan: run6Plan, scope: phaseScope(6) }
    );
  }, "phased");
});

test("a phase that is refused stops the run there: later phases are never dispatched and earlier commits stay", async () => {
  await withMode(
    async () => {
      await withApprovedRun(
        async ({ store, root, runId, head, worktreePath }) => {
          const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
          assert.equal(result.ok, false);
          if (result.ok) return;
          assert.match(result.reason, /^phase 3 of 6: implementer returned status blocked, not proposed$/);
          // Three dispatches were paid for, not six.
          assert.equal(agentRunCount(store, runId), 3);
          const stage = store.getStageChain(runId).find((s) => s.kind === "implementation")!;
          assert.equal(stage.status, "blocked");
          assert.equal(stage.gate_result, "block");
          assert.equal(store.getRun(runId)!.status, "blocked");
          assert.equal(existsSync(worktreePath), true, "the worktree survives the block");
          // The projections commit and the two phases that succeeded.
          const log = git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]);
          assert.equal(log.stdout.trim().split("\n").length, 3);
          assert.equal(auditActionCount(store, runId, "implementation.phase.apply"), 2);
          assert.equal(auditActionCount(store, runId, "implementation.gate.pass"), 0, "no handoff for a failed stage");
          assert.ok(existsSync(join(worktreePath, "src", "p2.ts")), "phase 2's file is retained");
          assert.ok(!existsSync(join(worktreePath, "src", "p3.ts")), "phase 3 wrote nothing");
        },
        { plan: run6Plan, scope: phaseScope(6) }
      );
    },
    "fail-at-phase",
    undefined,
    3
  );
});

test("an executor that writes into the tree during a later phase is refused naming that phase and every path", async () => {
  await withMode(
    async () => {
      await withApprovedRun(
        async ({ store, root, runId, worktreePath }) => {
          const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
          assert.equal(result.ok, false);
          if (result.ok) return;
          assert.match(result.reason, /^phase 2 of 6: worktree is not clean after dispatch: .*unreported\.txt/);
          assert.equal(agentRunCount(store, runId), 2);
          assert.equal(auditActionCount(store, runId, "implementation.phase.apply"), 1, "only phase 1 was applied");
          assert.ok(existsSync(join(worktreePath, "unreported.txt")), "the write is retained as evidence");
          assert.equal(store.getRun(runId)!.status, "blocked");
        },
        { plan: run6Plan, scope: phaseScope(6) }
      );
    },
    "mutate-at-phase",
    undefined,
    2
  );
});

test("a later phase may modify a path an earlier phase added", async () => {
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, worktreePath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        assert.equal(agentRunCount(store, runId), 7, "six phases and the self-review");
        // Phase 6 wrote last, so the file carries its marker, not phase 1's.
        assert.ok(readFileSync(join(worktreePath, "src", "p1.ts"), "utf8").endsWith("// phase 6\n"));
      },
      { plan: run6Plan, scope: phaseScope(1) }
    );
  }, "phased-modify");
});

test("a later phase adding a path an earlier phase committed is refused by the existing add rule, naming the phase", async () => {
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.match(result.reason, /^phase 2 of 6: add requires the file not to exist: src\/p1\.ts$/);
        assert.equal(agentRunCount(store, runId), 2);
        assert.equal(store.getRun(runId)!.status, "blocked");
      },
      { plan: run6Plan, scope: phaseScope(1) }
    );
  }, "phased-add-existing");
});

test("a phase drops a file it returned unchanged, records it, and commits only what changed", async () => {
  // Web-calculator run 1, phase 2 (test/fixtures/recorded/web-calculator-selfreview-run-1-phase-2-trailing-prose.json):
  // the reply returned index.html byte-identical to the phase 1 commit, and the
  // applier refused the whole patch. The emitter sends phase 1's file back
  // unchanged beside phase 2's own new file.
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, worktreePath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        assert.equal(agentRunCount(store, runId), 3, "two phases and the self-review");
        const applies = auditSummaries(store, runId, "implementation.phase.apply");
        assert.equal(applies.length, 2);
        const phase2Base = /base=([0-9a-f]+);/.exec(applies[1]!)![1]!;
        const phase2Head = /head=([0-9a-f]+)$/.exec(applies[1]!)![1]!;
        assert.deepEqual(auditSummaries(store, runId, "implementation.phase.dropped"), [
          `phase 2 of 2: unchanged at ${phase2Base}: src/p1.ts`,
        ]);
        const touched = git(worktreePath, ["diff", "--name-only", phase2Base, phase2Head]);
        assert.deepEqual(touched.stdout.trim().split("\n"), ["src/p2.ts"], "phase 2's commit holds only its own file");
      },
      { plan: tasksPlan(20), scope: phaseScope(2) }
    );
  }, "phased-unchanged");
});

test("a phase whose every returned file is unchanged blocks the run, naming the files, and commits nothing", async () => {
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, worktreePath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, false);
        if (result.ok) return;
        const phase1Head = lastPhaseHead(store, runId);
        assert.equal(
          result.reason,
          `phase 2 of 2: every returned file is unchanged at ${phase1Head} (src/p1.ts): a phase that changes nothing blocks the run`
        );
        assert.deepEqual(auditSummaries(store, runId, "implementation.content.invalid"), [result.reason]);
        assert.deepEqual(auditSummaries(store, runId, "implementation.phase.dropped"), [
          `phase 2 of 2: unchanged at ${phase1Head}: src/p1.ts`,
        ]);
        assert.equal(auditActionCount(store, runId, "implementation.phase.apply"), 1, "only phase 1 was applied");
        assert.equal(git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim(), phase1Head, "no phase 2 commit");
        assert.equal(agentRunCount(store, runId), 2, "the self-review was never dispatched");
        assert.equal(store.getRun(runId)!.status, "blocked");
      },
      { plan: tasksPlan(20), scope: phaseScope(2) }
    );
  }, "phased-all-unchanged");
});

test("each phase is told which scope paths exist in the worktree now, so a later phase modifies what an earlier one added", async () => {
  // Team-notes run 7: phase 4 proposed modify for a path no phase had created
  // and was refused. The emitter takes each action from the prompt's two lists
  // and throws on a path in neither, so a stage that stops computing them fails.
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, worktreePath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        assert.equal(agentRunCount(store, runId), 4, "three phases and the self-review");
        // Phase 1 added src/p1.ts; phases 2 and 3 modified it and added their own.
        assert.ok(readFileSync(join(worktreePath, "src", "p1.ts"), "utf8").endsWith("// phase 3\n"));
        assert.ok(existsSync(join(worktreePath, "src", "p2.ts")));
        assert.ok(existsSync(join(worktreePath, "src", "p3.ts")));
      },
      { plan: tasksPlan(30), scope: phaseScope(3) }
    );
  }, "phased-by-prompt");
});

test("a plan of exactly the frozen ceiling is implemented, and one task more is refused before any spend", async () => {
  // The ceiling is the frozen phase size times the frozen phase count: here
  // 2 x 3, which the live constants (10 x 8) would never refuse at 7 tasks, so
  // the second half proves the stage reads the frozen profile (hard rule 6).
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId }) => {
        freezePolicyValues(store, root, runId, { implementationPhaseTasks: 2, implementationMaxPhases: 3 });
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        assert.equal(agentRunCount(store, runId), 4, "six tasks at two per phase is three dispatches, then the self-review");
      },
      { plan: tasksPlan(6), scope: phaseScope(3) }
    );
    await withApprovedRun(
      async ({ store, root, runId, worktreePath }) => {
        freezePolicyValues(store, root, runId, { implementationPhaseTasks: 2, implementationMaxPhases: 3 });
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.match(
          result.reason,
          /the approved plan has 7 tasks, more than the frozen ceiling of 6 \(2 tasks per phase, at most 3 phases\)/
        );
        assert.equal(agentRunCount(store, runId), 0, "nothing was dispatched");
        assert.equal(existsSync(worktreePath), false, "no worktree was created");
        assert.ok(!store.getStageChain(runId).some((s) => s.kind === "implementation"), "no stage row was created");
        assert.equal(store.getRun(runId)!.status, "in_progress", "the refusal blocks nothing: it costs nothing");
      },
      { plan: tasksPlan(7), scope: phaseScope(4) }
    );
  }, "phased");
});

test("a nested plan is counted and split by its task items, not its lines", async () => {
  // Team-notes run 12: 53 tasks with 173 indented detail lines beneath them,
  // 226 lines in all, refused at the ceiling of 80. Here the ceiling is 2 x 3 = 6:
  // six items of three detail lines each are 24 lines, so a stage still counting
  // lines would refuse this plan, and one counting items runs three phases of two.
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId }) => {
        freezePolicyValues(store, root, runId, { implementationPhaseTasks: 2, implementationMaxPhases: 3 });
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        assert.equal(agentRunCount(store, runId), 4, "six items at two per phase is three dispatches, then the self-review");
        const events = store
          .query<{ summary: string }>(
            "SELECT summary FROM audit WHERE run_id = ? AND action = 'implementation.phase.apply' ORDER BY id",
            [runId]
          )
          .map((e) => e.summary);
        assert.match(events[0]!, /^phase 1 of 3: tasks 1-2; /);
        assert.match(events[1]!, /^phase 2 of 3: tasks 3-4; /);
        assert.match(events[2]!, /^phase 3 of 3: tasks 5-6; /);
      },
      { plan: nestedTasksPlan(6, 3), scope: phaseScope(3) }
    );
    await withApprovedRun(
      async ({ store, root, runId, worktreePath }) => {
        freezePolicyValues(store, root, runId, { implementationPhaseTasks: 2, implementationMaxPhases: 3 });
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.match(
          result.reason,
          /the approved plan has 7 tasks, more than the frozen ceiling of 6 \(2 tasks per phase, at most 3 phases\)/
        );
        assert.equal(agentRunCount(store, runId), 0, "nothing was dispatched");
        assert.equal(existsSync(worktreePath), false, "no worktree was created");
        assert.ok(!store.getStageChain(runId).some((s) => s.kind === "implementation"), "no stage row was created");
      },
      { plan: nestedTasksPlan(7, 3), scope: phaseScope(4) }
    );
  }, "phased");
});

test("a nested plan's phase prompt keeps each task's detail lines directly under it, and the stage sent that prompt", async () => {
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, specPath, planPath }) => {
        freezePolicyValues(store, root, runId, { implementationPhaseTasks: 2, implementationMaxPhases: 3 });
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        const first = store.query<{ input_hash: string }>(
          "SELECT ar.input_hash FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? ORDER BY ar.id LIMIT 1",
          [runId]
        )[0]!;
        const gate = store.query<{ summary: string }>(
          "SELECT summary FROM audit WHERE run_id = ? AND action = 'implementation.gate.pass' ORDER BY id DESC LIMIT 1",
          [runId]
        )[0]!;
        const handoff = parseImplementationGate(gate.summary);
        assert.ok(handoff.ok, handoff.ok ? "" : handoff.reason);
        const planText = readFileSync(planPath, "utf8");
        const plan = validatePlanDoc(planText);
        assert.ok(plan.ok, plan.ok ? "" : plan.reason);
        const prompt = buildImplementationAuthorPrompt(
          IMPLEMENTER,
          planText,
          readFileSync(specPath, "utf8"),
          phaseScope(3),
          handoff.value.base,
          planPhases(plan.value.taskItems, 2)[0]!,
          [],
          VERIFICATION
        );
        assert.equal(sha256Hex(prompt), first.input_hash, "the stage sent the prompt built from the task items");
        const block = prompt.slice(prompt.indexOf("Tasks for this phase"), prompt.indexOf("Approved plan:"));
        assert.ok(
          block.includes(
            "- Task 1:\n  - detail 1.1\n  - detail 1.2\n  - detail 1.3\n- Task 2:\n  - detail 2.1\n  - detail 2.2\n  - detail 2.3\n"
          ),
          block
        );
        assert.ok(!block.includes("Task 3"), "the phase ends after its second item");
      },
      { plan: nestedTasksPlan(6, 3), scope: phaseScope(3) }
    );
  }, "phased");
});

test("a plan that does not parse is refused by name before any stage row or spend", async () => {
  await withApprovedRun(
    async ({ store, root, runId, worktreePath }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /the approved plan .*plan\.md does not parse: tasks must not be empty/);
      assert.equal(agentRunCount(store, runId), 0);
      assert.equal(existsSync(worktreePath), false);
    },
    // Hashed and gated like any other plan, so only the stage's own parse can refuse it.
    { plan: (specHash) => `feature: demo\nplan_for: ${specHash}\n\n## Tasks\n\n## Coverage\n\n- AC-001 -> src/a1.ts\n` }
  );
});

test("the implementation stage reads the phase size and ceiling from the frozen profile, never the live constants", () => {
  const source = readFileSync(join(process.cwd(), "src", "implementation-stage.ts"), "utf8");
  assert.ok(source.includes("profile.policy"), "the stage reads profile.policy");
  assert.ok(!/IMPLEMENTATION_PHASE_TASKS|IMPLEMENTATION_MAX_PHASES/.test(source));
});

// --- delivery over a multi-commit range (src/delivery-coverage.ts) ------------

/** The net changed paths and the handoff of a passed implementation stage. */
function netRange(store: Store, runId: number, worktreePath: string): { base: string; head: string; changed: string[] } {
  const gate = store.query<{ summary: string }>(
    "SELECT summary FROM audit WHERE run_id = ? AND action = 'implementation.gate.pass' ORDER BY id DESC LIMIT 1",
    [runId]
  )[0]!;
  const parsed = parseImplementationGate(gate.summary);
  assert.equal(parsed.ok, true);
  const diff = git(worktreePath, ["diff", "--name-only", `${parsed.value.base}..${parsed.value.head}`]);
  assert.equal(diff.status, 0, diff.stderr);
  return { ...parsed.value, changed: diff.stdout.trim().split("\n").filter((l) => l !== "") };
}

test("a path touched by six phases is one entry in the net range and satisfies delivery of that artifact", async () => {
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, worktreePath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        // Six commits touched src/p1.ts; the range names it once.
        const { changed } = netRange(store, runId, worktreePath);
        assert.deepEqual(changed, ["src/p1.ts"]);
        const coverage = deliveryCoverage(["src/p1.ts"], changed);
        assert.deepEqual(coverage.delivered, ["src/p1.ts"]);
        assert.deepEqual(coverage.missing, []);
      },
      { plan: run6Plan, scope: phaseScope(1) }
    );
  }, "phased-modify");
});

test("a base file one phase changes and a later phase restores drops out of the range, so delivery fails closed", async () => {
  // The limitation delivery-coverage.ts states: nothing stops a later phase
  // putting a path that existed at the base back to its base content, and the
  // net range then no longer names it. The outcome that matters is the
  // direction: a declared artifact is reported missing and delivery blocks; it
  // is never reported delivered. base.txt is committed in the fixture repository.
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, worktreePath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        assert.equal(agentRunCount(store, runId), 4, "three phases and the self-review");
        const { changed } = netRange(store, runId, worktreePath);
        assert.deepEqual(changed, ["src/p3.ts"], "base.txt was changed by phase 1 and restored by phase 2");
        assert.equal(readFileSync(join(worktreePath, "base.txt"), "utf8"), BASE_MARKER, "restored byte for byte");
        const coverage = deliveryCoverage(["base.txt", "src/p3.ts"], changed);
        assert.deepEqual(coverage.delivered, ["src/p3.ts"]);
        assert.deepEqual(coverage.missing, ["base.txt"], "delivery blocks on it: fails closed");
      },
      { plan: tasksPlan(30), scope: ["base.txt", "src/p2.ts", "src/p3.ts"] }
    );
  }, "phased-restore");
});

// --- the self-review after the last phase (docs/features/implementation-self-review/plan.md) ---

/** The parsed `implementation.gate.pass` handoff of a passed stage. */
function gateHandoff(store: Store, runId: number): { base: string; head: string } {
  const gate = store.query<{ summary: string }>(
    "SELECT summary FROM audit WHERE run_id = ? AND action = 'implementation.gate.pass' ORDER BY id DESC LIMIT 1",
    [runId]
  )[0]!;
  const parsed = parseImplementationGate(gate.summary);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
  return parsed.value;
}

/** Every summary recorded under one audit action, in order. */
function auditSummaries(store: Store, runId: number, action: string): string[] {
  return store
    .query<{ summary: string }>("SELECT summary FROM audit WHERE run_id = ? AND action = ? ORDER BY id", [runId, action])
    .map((e) => e.summary);
}

/** The head the last phase committed, read from its own `implementation.phase.apply` event. */
function lastPhaseHead(store: Store, runId: number): string {
  const events = auditSummaries(store, runId, "implementation.phase.apply");
  assert.ok(events.length > 0, "a phase was applied");
  return /head=([0-9a-f]+)$/.exec(events[events.length - 1]!)![1]!;
}

test("a clean self-review is one more implementer dispatch, commits nothing, and records its critique", async () => {
  await withApprovedRun(async ({ store, root, runId, head, worktreePath }) => {
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const settings = store.query<{ setting: string }>(
      "SELECT ar.setting FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? ORDER BY ar.id",
      [runId]
    );
    assert.deepEqual(settings.map((r) => r.setting), ["implementer", "implementer"], "one phase, then the self-review");
    const phaseHead = lastPhaseHead(store, runId);
    const log = git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]);
    assert.equal(log.stdout.trim().split("\n").length, 2, "the projections and the phase: no self-review commit");
    assert.equal(gateHandoff(store, runId).head, phaseHead, "the gate head is the last phase's commit");
    const pass = auditSummaries(store, runId, "implementation.selfreview.pass");
    assert.equal(pass.length, 1);
    assert.equal(pass[0], `critique=1; recorded=1; patches=0; dropped=none; base=${phaseHead}; head=${phaseHead}`);
    assert.equal(auditSummaries(store, runId, "implementation.selfreview.critique").length, 1);
    assert.equal(auditSummaries(store, runId, "implementation.selfreview.skipped").length, 0);
    assert.equal(verifyAuditChain(store), null);
  });
});

test("a self-review fix commits after the last phase, becomes the gate head, and is what verification reads", async () => {
  await withMode(async () => {
    await withApprovedRun(async ({ store, root, runId, head, worktreePath }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, true, (result as { reason?: string }).reason);
      const phaseHead = lastPhaseHead(store, runId);
      const tip = git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();
      assert.notEqual(tip, phaseHead, "the self-review committed");
      assert.equal(git(worktreePath, ["rev-parse", "HEAD~1"]).stdout.trim(), phaseHead, "directly after the last phase");
      const messages = git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]).stdout.trim().split("\n");
      assert.equal(messages[0], `bw run ${runId}: self-review (base ${phaseHead.slice(0, 8)})`);
      assert.ok(readFileSync(join(worktreePath, "src", "a1.ts"), "utf8").endsWith("// self-review\n"));
      assert.equal(gateHandoff(store, runId).head, tip, "the gate head is the self-review's commit");
      assert.equal(auditSummaries(store, runId, "implementation.selfreview.patch.apply").length, 1);
      assert.equal(
        auditSummaries(store, runId, "implementation.selfreview.pass")[0],
        `critique=1; recorded=1; patches=1; dropped=none; base=${phaseHead}; head=${tip}`
      );
      const verification = await runVerificationStage(store, { runId, rootDir: root });
      assert.equal(verification.ok, true, (verification as { reason?: string }).reason);
      const verified = auditSummaries(store, runId, "verification.gate.pass");
      assert.ok(verified[0]!.startsWith(`verified ${tip} in `), verified[0]);
    });
  }, "self-review-fix");
});

test("a self-review that returns a file unchanged drops it, commits nothing, and names it", async () => {
  await withMode(async () => {
    await withApprovedRun(async ({ store, root, runId, head, worktreePath }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, true, (result as { reason?: string }).reason);
      const phaseHead = lastPhaseHead(store, runId);
      assert.equal(git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]).stdout.trim().split("\n").length, 2);
      assert.equal(gateHandoff(store, runId).head, phaseHead);
      assert.equal(
        auditSummaries(store, runId, "implementation.selfreview.pass")[0],
        `critique=1; recorded=1; patches=0; dropped=${SCOPE[0]}; base=${phaseHead}; head=${phaseHead}`
      );
    });
  }, "self-review-unchanged");
});

for (const [mode, expected] of [
  ["self-review-empty-critique", /self-review critique must not be empty/],
  // Under --json-schema a reply that never reached the structured channel is a
  // failed dispatch, refused at the envelope (docs/features/structured-patch-output/plan.md).
  ["self-review-not-json", /dispatch failed: dispatched agent implementer \(author\) on stage \d+: envelope parse failed: harness envelope for executor claude-code has a result line without a structured_output object although the dispatch requested --json-schema: line \d+/],
  ["self-review-bad-patch", /a proposed patch has no files/],
  ["self-review-blocked", /implementer returned status blocked, not proposed/],
  // A null entry makes validateAgentResult throw; the stage catches it as a refusal.
  ["self-review-null-patch", /implementer result refused: /],
] as const) {
  test(`a self-review reply the stage cannot use is skipped, and the stage passes on the last phase (${mode})`, async () => {
    await withMode(async () => {
      await withApprovedRun(async ({ store, root, runId, head, worktreePath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        assert.equal(store.getRun(runId)!.status, "in_progress");
        const phaseHead = lastPhaseHead(store, runId);
        const skipped = auditSummaries(store, runId, "implementation.selfreview.skipped");
        assert.equal(skipped.length, 1);
        assert.ok(skipped[0]!.startsWith(`base=${phaseHead}; reason=self-review: `), skipped[0]);
        assert.match(skipped[0]!, expected);
        assert.equal(auditSummaries(store, runId, "implementation.selfreview.pass").length, 0);
        assert.equal(auditSummaries(store, runId, "implementation.selfreview.critique").length, 0);
        assert.equal(git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]).stdout.trim().split("\n").length, 2);
        assert.equal(gateHandoff(store, runId).head, phaseHead, "the gate head is the last phase's commit");
      });
    }, mode);
  });
}

test("a long self-review critique is recorded bounded: 50 entries, the long one cut with its length named", async () => {
  await withMode(async () => {
    await withApprovedRun(async ({ store, root, runId }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, true, (result as { reason?: string }).reason);
      const critique = auditSummaries(store, runId, "implementation.selfreview.critique");
      assert.equal(critique.length, 50);
      assert.ok(critique[0]!.endsWith("(cut at 2000 of 2001 characters)"), critique[0]!.slice(-60));
      assert.match(auditSummaries(store, runId, "implementation.selfreview.pass")[0]!, /^critique=51; recorded=50; /);
    });
  }, "self-review-long-critique");
});

/** A self-review guard refusal: the stage and run block, and the phases' commits stay. */
async function expectSelfReviewBlock(
  mode: string,
  check: (ctx: Ctx, reason: string, phaseHead: string) => void
): Promise<void> {
  await withMode(async () => {
    await withApprovedRun(async (ctx) => {
      const { store, root, runId, worktreePath } = ctx;
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.ok(result.reason.startsWith("self-review: "), result.reason);
      assert.deepEqual(auditSummaries(store, runId, "implementation.selfreview.failed"), [result.reason]);
      const stage = store.getStageChain(runId).find((s) => s.kind === "implementation")!;
      assert.equal(stage.status, "blocked");
      assert.equal(stage.gate_result, "block");
      assert.equal(store.getRun(runId)!.status, "blocked");
      assert.equal(existsSync(worktreePath), true, "the worktree survives the block");
      assert.equal(auditSummaries(store, runId, "implementation.gate.pass").length, 0);
      check(ctx, result.reason, lastPhaseHead(store, runId));
    });
  }, mode);
}

test("a self-review patch outside the signed scope blocks the run by name, and the phase commits stay", () =>
  expectSelfReviewBlock("self-review-out-of-scope", ({ worktreePath, head }, reason, phaseHead) => {
    assert.match(reason, /src\/never-approved\.ts/);
    assert.equal(git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim(), phaseHead, "nothing was committed");
    assert.equal(git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]).stdout.trim().split("\n").length, 2);
  }));

test("a self-review dispatch that writes into the tree blocks the run naming the path", () =>
  expectSelfReviewBlock("self-review-mutate", ({ worktreePath }, reason) => {
    assert.match(reason, /^self-review: worktree is not clean after the self-review dispatch: .*unreported\.txt/);
    assert.ok(existsSync(join(worktreePath, "unreported.txt")), "the write is retained as evidence");
  }));

test("a failed self-review dispatch that also wrote into the tree blocks the run, not skips it", () =>
  expectSelfReviewBlock("self-review-mutate-fail", ({ store, runId }, reason) => {
    assert.match(reason, /^self-review: worktree is not clean after the self-review dispatch: .*unreported\.txt/);
    assert.equal(auditSummaries(store, runId, "implementation.selfreview.skipped").length, 0);
  }));

test("a change whose diff is over the prompt ceiling skips the self-review as a failed dispatch", async () => {
  // Two phases each add a file of about 600 KB (the emitter embeds base.txt), so
  // the net diff passes 1 MiB while each phase reply stays under the result cap.
  // The self-review prompt carries that diff, so dispatchOnce refuses it; the
  // run goes on to code review, which refuses the same size by name.
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        const phaseHead = lastPhaseHead(store, runId);
        const diff = git(join(root, ".governance", "worktrees", String(runId)), ["diff", "--no-color", gateHandoff(store, runId).base, phaseHead]);
        assert.ok(diff.stdout.length > PROMPT_MAX_BYTES, `the diff is ${diff.stdout.length} bytes`);
        assert.deepEqual(auditSummaries(store, runId, "implementation.selfreview.skipped"), [
          `base=${phaseHead}; reason=self-review: dispatch failed: prompt exceeds ${PROMPT_MAX_BYTES} bytes`,
        ]);
        assert.equal(agentRunCount(store, runId), 2, "the refused prompt never reached the executor");
        assert.equal(gateHandoff(store, runId).head, phaseHead);
      },
      { plan: tasksPlan(20), scope: phaseScope(2), baseContent: "a".repeat(600_000) }
    );
  }, "phased");
});

test("a self-review dispatch that commits in the checkout blocks the run naming both heads", () =>
  expectSelfReviewBlock("self-review-commit", ({ worktreePath }, reason, phaseHead) => {
    const moved = git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();
    assert.notEqual(moved, phaseHead);
    assert.equal(
      reason,
      `self-review: the worktree head moved during the self-review dispatch: expected ${phaseHead}, found ${moved}`
    );
  }));

test("the self-review prompt the stage sent has the last phase's commit as its base", async () => {
  // `agent_run.input_hash` is the SHA-256 of the prompt sent. The prompt is
  // rebuilt from the run's own plan, spec and signed scope, and the diff of the
  // gate's range read with the commands the stage uses.
  await withApprovedRun(async ({ store, root, runId, specPath, planPath, worktreePath }) => {
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const rows = store.query<{ input_hash: string }>(
      "SELECT ar.input_hash FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? ORDER BY ar.id",
      [runId]
    );
    assert.equal(rows.length, 2);
    const { base } = gateHandoff(store, runId);
    const phaseHead = lastPhaseHead(store, runId);
    const names = git(worktreePath, ["diff", "--name-only", "-z", base, phaseHead]);
    const diff = git(worktreePath, ["diff", "--no-color", base, phaseHead]);
    assert.equal(names.status, 0, names.stderr);
    assert.equal(diff.status, 0, diff.stderr);
    const prompt = buildImplementationSelfReviewPrompt(
      IMPLEMENTER,
      readFileSync(planPath, "utf8"),
      readFileSync(specPath, "utf8"),
      SCOPE,
      phaseHead,
      SCOPE,
      names.stdout.split("\0").filter((p) => p !== ""),
      diff.stdout,
      VERIFICATION
    );
    assert.ok(prompt.includes(`baseCommit must be exactly: ${phaseHead}`));
    assert.equal(rows[1]!.input_hash, sha256Hex(prompt), "the stage sent the self-review built on the last phase's commit");
  });
});

test("a run frozen with an implementer that lacks the self-review output is refused before the stage row", async () => {
  await withApprovedRun(async ({ store, root, runId, worktreePath }) => {
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as { agents: { id: string; outputs: string[] }[] };
    profile.agents.find((a) => a.id === "implementer")!.outputs = ["patches"];
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));

    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "configured agent implementer does not allow implementation-self-review output");
    assert.equal(agentRunCount(store, runId), 0, "nothing was spent");
    assert.equal(existsSync(worktreePath), false, "no worktree was created");
    assert.ok(!store.getStageChain(runId).some((s) => s.kind === "implementation"), "no stage row was created");
  });
});
