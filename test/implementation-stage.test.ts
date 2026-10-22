import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { runImplementationStage } from "../src/implementation-stage.ts";
import { freezeUniformProfile } from "./uniform-profile.ts";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { parseImplementationGate } from "../src/handoff.ts";
import { policyHash } from "../src/policy.ts";
import { deliveryCoverage } from "../src/delivery-coverage.ts";
import { parseWorkspaceReply, validateWorkspaceReply, WORKSPACE_REPLY_SCHEMA } from "../src/agent-result.ts";
import {
  acceptanceRuns,
  committedSuiteMount,
  markUnremovable,
  markUnstartable,
  recordingDockerCommand,
  sandboxPrefix,
  serveAcceptanceReport,
  workContainerMounts,
} from "./fixtures/docker/stand-in.ts";
import { ACCEPTANCE_STUB_PAGE, acceptanceCommand, readAcceptanceReport } from "../src/acceptance.ts";
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
const VERIFICATION: VerificationConfig = { commands: [{ name: "unit", command: ["node", "--version"] }], derived: [] };
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
    /** Further files committed beside base.txt in the base commit. */
    baseFiles?: Record<string, string>;
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
    for (const [path, content] of Object.entries(opts.baseFiles ?? {})) writeFileSync(join(root, path), content);
    const addBase = git(root, ["add", "base.txt", ...(opts.gitignore !== undefined ? [".gitignore"] : []), ...Object.keys(opts.baseFiles ?? {})]);
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
  const other: VerificationConfig = { commands: [{ name: "smoke", command: ["node", "--version"] }], derived: [] };
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

/** The head the projections commit left: the branch head before any phase. */
function projectionsHead(store: Store, runId: number, worktreePath: string): string {
  const log = git(worktreePath, ["log", "--format=%H|%s"]).stdout.trim().split("\n");
  const line = log.find((l) => l.endsWith(`|bw run ${runId}: projections (spec and plan)`));
  assert.ok(line, "the projections commit exists");
  return line.split("|")[0]!;
}

/** The sentence a refusal ends with: where the refused change is kept (`commitWorkspace`). */
const KEPT = String.raw`; the refused change is kept as commit ([0-9a-f]{40,64}) \(refs\/buildworks\/refused\/\1\)`;

test("an out-of-scope write is refused naming the path, kept as a commit, and the worktree is reset to the phase's base", () =>
  expectGateRefusal(
    { mode: "out-of-scope" },
    new RegExp(String.raw`^the agent's changes were refused: outside the signed scope: src\/never-approved\.ts${KEPT}$`),
    async ({ store, runId, worktreePath }) => {
      assert.equal(auditActionCount(store, runId, "implementation.workspace.refused"), 1);
      assert.equal(git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim(), projectionsHead(store, runId, worktreePath));
      assert.ok(!existsSync(join(worktreePath, "src", "never-approved.ts")), "the refused write was reset");
      assert.equal(git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]).stdout, "");
      const kept = new RegExp(KEPT).exec(auditSummaries(store, runId, "implementation.workspace.refused")[0]!)![1]!;
      assert.equal(git(worktreePath, ["diff", "--name-only", projectionsHead(store, runId, worktreePath), kept]).stdout.trim(), "src/never-approved.ts");
    }
  ));

test("a phase whose diff cannot be computed (a moved head) blocks as a workspace failure, not a refusal", () =>
  expectGateRefusal(
    { mode: "commit" },
    /^compute diff: the worktree head moved from [0-9a-f]{40,64} to [0-9a-f]{40,64} while the agent ran; the worktree is kept as evidence$/,
    async ({ store, runId }) => {
      assert.equal(auditActionCount(store, runId, "implementation.workspace.failed"), 1);
      assert.equal(auditActionCount(store, runId, "implementation.workspace.refused"), 0);
    }
  ));

test("a phase reply that says completed but lists an incomplete task is refused as invalid content", () =>
  expectGateRefusal(
    { mode: "completed-with-incomplete" },
    /^implementer reply refused: the reply says completed but lists incomplete tasks: Build the other thing$/,
    async ({ store, runId }) => {
      assert.equal(auditActionCount(store, runId, "implementation.content.invalid"), 1);
      assert.equal(auditActionCount(store, runId, "implementation.phase.apply"), 0);
    }
  ));

test("a write touching a protected path is refused naming it", () =>
  expectGateRefusal(
    { mode: "protected", scope: ["src/agents/evil.ts"] },
    /touches a protected path: src\/agents\/evil\.ts/
  ));

test("a completed phase that changed nothing is refused as invalid content", () =>
  expectGateRefusal(
    { mode: "empty" },
    /^the implementer changed nothing at [0-9a-f]{40,64}: a phase that changes nothing blocks the run$/,
    async ({ store, runId }) => {
      assert.equal(auditActionCount(store, runId, "implementation.content.invalid"), 1);
    }
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
      // requested model, the effort, the retained prompt and the tool evidence
      // after the refusal.
      assert.match(
        auditSummaries(store, runId, "implementation.author.failed")[0]!,
        /; the line reports total_cost_usd 0 \(requested model m, effort medium; prompt \S+\.txt; tool log \S+\.jsonl; proxy log \S+-proxy\.log\)$/
      );
    }
  ));

test("a reply that did not complete is refused quoting its summary and incomplete tasks", () =>
  expectGateRefusal(
    { mode: "non-proposed" },
    /^implementer returned status blocked, not completed: fixture implementation refused; incomplete: Build the thing$/
  ));

test("an executor that writes beyond its scope is refused naming every path, and only ignored output is removed silently", async () => {
  // The recorded smoke's implementer wrote outside what it was asked to change.
  // In tool mode that is an out-of-scope write: the boundary removes ignored
  // output, then refuses the untracked file and the tracked modification by name.
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, worktreePath, head }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.match(result.reason, /^the agent's changes were refused: /);
        // Both refused paths are named (asserted individually: git's order is not pinned).
        for (const entry of ["outside the signed scope: unreported.txt", "outside the signed scope: base.txt"]) {
          assert.ok(result.reason.includes(entry), `the refusal must name ${entry}: ${result.reason}`);
        }
        assert.ok(!result.reason.includes("ignored-residue.txt"), "ignored output is removed, not refused");
        const stage = store.getStageChain(runId).find((s) => s.kind === "implementation")!;
        assert.equal(stage.status, "blocked");
        assert.equal(stage.gate_result, "block");
        assert.equal(store.getRun(runId)!.status, "blocked");
        assert.equal(existsSync(worktreePath), true, "the worktree survives the block");
        // Nothing was committed, and the worktree is reset to the phase's base.
        assert.equal(auditActionCount(store, runId, "implementation.phase.apply"), 0);
        const log = git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]);
        assert.equal(log.status, 0);
        assert.equal(
          log.stdout.trim().split("\n").filter((l) => l !== "").length,
          1,
          "the branch holds only the projections commit"
        );
        assert.equal(readFileSync(join(worktreePath, "base.txt"), "utf8"), BASE_MARKER, "the tracked change was reset");
        for (const residue of ["unreported.txt", "ignored-residue.txt", "src/a1.ts"]) {
          assert.ok(!existsSync(join(worktreePath, residue)), `${residue} was removed by the reset`);
        }
      },
      { gitignore: "ignored-residue.txt" }
    );
  }, "mutate-then-propose");
});

test("an option-like scope path is committed as a literal path", async () => {
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

test("a phase whose work container cannot be removed blocks before anything reads the worktree, and the branch head is unchanged", async () => {
  // docs/features/sandboxed-implementer/plan.md, Task 10: a container not
  // proven gone could still be writing, so no commit follows it.
  await withApprovedRun(async ({ store, root, runId, worktreePath }) => {
    const unmark = markUnremovable(sandboxPrefix(root, runId, "phase-1"));
    try {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /^work container \S+ \(\S+\) could not be proven removed, so a process left in it could still write the worktree: /);
      assert.deepEqual(auditSummaries(store, runId, "implementation.sandbox.quiescence.failed"), [result.reason]);
      assert.equal(auditActionCount(store, runId, "implementation.phase.apply"), 0);
      assert.equal(agentRunCount(store, runId), 1, "the phase was dispatched; the self-review never was");
      assert.equal(git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim(), projectionsHead(store, runId, worktreePath));
      assert.ok(existsSync(join(worktreePath, "src", "a1.ts")), "the uncommitted write is kept as evidence");
      assert.equal(store.getRun(runId)!.status, "blocked");
    } finally {
      unmark();
    }
  });
});

test("a phase whose sandbox cannot start blocks with implementation.sandbox.failed before any dispatch", async () => {
  // docs/features/sandboxed-implementer/plan.md, Task 9 step 2.
  await withApprovedRun(async ({ store, root, runId, worktreePath }) => {
    const unmark = markUnstartable(sandboxPrefix(root, runId, "phase-1"));
    try {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /^cannot start the implementation sandbox: start proxy \S+ failed \(docker exit 125\): .*unstartable/);
      assert.deepEqual(auditSummaries(store, runId, "implementation.sandbox.failed"), [result.reason]);
      assert.equal(agentRunCount(store, runId), 0, "nothing was dispatched");
      assert.equal(git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim(), projectionsHead(store, runId, worktreePath));
      assert.equal(store.getRun(runId)!.status, "blocked");
    } finally {
      unmark();
    }
  });
});

test("a self-review whose sandbox cannot start blocks the run, and the phase commit stays", async () => {
  await withApprovedRun(async ({ store, root, runId, worktreePath }) => {
    const unmark = markUnstartable(sandboxPrefix(root, runId, "self-review"));
    try {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /^self-review: cannot start the implementation sandbox: start proxy \S+ failed/);
      assert.deepEqual(auditSummaries(store, runId, "implementation.sandbox.failed"), [result.reason]);
      assert.equal(agentRunCount(store, runId), 1, "the phase was dispatched; the self-review never was");
      assert.equal(git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim(), lastPhaseHead(store, runId));
      assert.equal(store.getRun(runId)!.status, "blocked");
    } finally {
      unmark();
    }
  });
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
    const prompt = ["This is phase 1 of 1.", "", "Patch only these paths:", "", "- src/a.ts", "", ""].join("\n");
    const env = { ...process.env };
    delete env.EMIT_MODE;
    // The phase dispatch sends the workspace reply schema and a tool server;
    // the answer is read from structured_output.
    const args = [FIXTURE, "--json-schema", JSON.stringify(WORKSPACE_REPLY_SCHEMA), "--mcp-config", "unused.json"];
    const run = spawnSync("node", args, { cwd: scratch, input: prompt, encoding: "utf8", env });
    assert.equal(run.status, 0, run.stderr);
    const envelope = parseEnvelope(fixtureExecutor(), run.stdout, true);
    const reply = parseWorkspaceReply(envelope.resultText, validateWorkspaceReply);
    assert.equal(reply.ok, true, reply.ok ? "" : reply.reason);
    assert.ok(readFileSync(join(scratch, "src", "a.ts"), "utf8").includes(BASE_MARKER), "the write landed in the working directory");
    // Without either flag the fixture refuses, so a stage that forgets one fails its tests.
    for (const missing of ["--json-schema", "--mcp-config"]) {
      const at = args.indexOf(missing);
      const without = [...args.slice(0, at), ...args.slice(at + 2)];
      const refused = spawnSync("node", without, { cwd: scratch, input: prompt, encoding: "utf8", env });
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, new RegExp(`a phase prompt arrived without ${missing}`));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("the gate event records the handoff: the projections commit as base, the applied head as head", async () => {
  // Step 8 task 2: the `implementation.gate.pass` event carries both commits
  // in the one canonical shape — the base the phases started from (the head
  // after the projections commit, before any phase commit) and the final head.
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
        assert.match(events[0]!, /^phase 1 of 6: tasks 1-10; base=[0-9a-f]{40,64}; head=[0-9a-f]{40,64}; paths=src\/p1\.ts$/);
        assert.match(events[5]!, /^phase 6 of 6: tasks 51-57; /);

        // The projections commit, then one commit per phase, newest first.
        const log = git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]);
        const messages = log.stdout.trim().split("\n");
        assert.equal(messages.length, 7);
        assert.match(messages[0]!, new RegExp(`^bw run ${runId}: phase 6/6 \\(base [0-9a-f]{8}\\)$`));
        assert.match(messages[5]!, new RegExp(`^bw run ${runId}: phase 1/6 \\(base [0-9a-f]{8}\\)$`));
        assert.equal(messages[6], `bw run ${runId}: projections (spec and plan)`);

        // Each phase proposed against the head the previous phase committed.
        const heads = events.map((e) => /head=([0-9a-f]+);/.exec(e)![1]!);
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
          assert.match(
            result.reason,
            /^phase 3 of 6: implementer returned status blocked, not completed: fixture refused this phase; incomplete: phase 3$/
          );
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

test("an executor that writes beyond its scope during a later phase is refused naming that phase and the path", async () => {
  await withMode(
    async () => {
      await withApprovedRun(
        async ({ store, root, runId, worktreePath }) => {
          const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
          assert.equal(result.ok, false);
          if (result.ok) return;
          assert.match(result.reason, new RegExp(String.raw`^phase 2 of 6: the agent's changes were refused: outside the signed scope: unreported\.txt${KEPT}$`));
          assert.equal(agentRunCount(store, runId), 2);
          assert.equal(auditActionCount(store, runId, "implementation.phase.apply"), 1, "only phase 1 was applied");
          assert.ok(existsSync(join(worktreePath, "src", "p1.ts")), "phase 1's commit stays");
          assert.ok(!existsSync(join(worktreePath, "unreported.txt")), "the worktree is reset to phase 2's base");
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
  return /head=([0-9a-f]+);/.exec(events[events.length - 1]!)![1]!;
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
    assert.equal(pass[0], `critique=1; recorded=1; changed=none; base=${phaseHead}; head=${phaseHead}`);
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
      assert.equal(
        auditSummaries(store, runId, "implementation.selfreview.pass")[0],
        `critique=1; recorded=1; changed=${SCOPE[0]}; base=${phaseHead}; head=${tip}`
      );
      const verification = await runVerificationStage(store, { runId, rootDir: root });
      assert.equal(verification.ok, true, (verification as { reason?: string }).reason);
      const verified = auditSummaries(store, runId, "verification.gate.pass");
      assert.ok(verified[0]!.startsWith(`verified ${tip} in `), verified[0]);
    });
  }, "self-review-fix");
});

test("a self-review that rewrites a file unchanged commits nothing and passes on the last phase", async () => {
  await withMode(async () => {
    await withApprovedRun(async ({ store, root, runId, head, worktreePath }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, true, (result as { reason?: string }).reason);
      const phaseHead = lastPhaseHead(store, runId);
      assert.equal(git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]).stdout.trim().split("\n").length, 2);
      assert.equal(gateHandoff(store, runId).head, phaseHead);
      assert.equal(
        auditSummaries(store, runId, "implementation.selfreview.pass")[0],
        `critique=1; recorded=1; changed=none; base=${phaseHead}; head=${phaseHead}`
      );
    });
  }, "self-review-unchanged");
});

for (const [mode, expected, discarded] of [
  ["self-review-empty-critique", /self-review critique must not be empty/, "none"],
  // Under --json-schema a reply that never reached the structured channel is a
  // failed dispatch, refused at the envelope (docs/features/structured-patch-output/plan.md).
  ["self-review-not-json", /dispatch failed: dispatched agent implementer \(author\) on stage \d+: envelope parse failed: harness envelope for executor claude-code has a result line without a structured_output object although the dispatch requested --json-schema: line \d+/, "none"],
  ["self-review-blocked", /implementer returned status blocked, not completed: fixture self-review; incomplete: none listed$/, "none"],
  // A failed dispatch that also wrote into the checkout: what it wrote is
  // discarded and named, and the stage passes on the last phase.
  ["self-review-mutate-fail", /reason=self-review: dispatch failed: /, "unreported.txt"],
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
        assert.ok(skipped[0]!.startsWith(`base=${phaseHead}; discarded=${discarded}; reason=self-review: `), skipped[0]);
        assert.match(skipped[0]!, expected);
        assert.equal(git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]).stdout, "", "the checkout is clean");
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

test("a self-review write outside the signed scope blocks the run by name, and the phase commits stay", () =>
  expectSelfReviewBlock("self-review-out-of-scope", ({ worktreePath, head }, reason, phaseHead) => {
    assert.match(reason, new RegExp(String.raw`^self-review: the agent's changes were refused: outside the signed scope: src\/never-approved\.ts${KEPT}$`));
    assert.equal(git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim(), phaseHead, "nothing was committed");
    assert.equal(git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]).stdout.trim().split("\n").length, 2);
  }));

test("a self-review that writes beyond its scope beside a clean reply blocks the run naming the path", () =>
  expectSelfReviewBlock("self-review-mutate", ({ worktreePath }, reason) => {
    assert.match(reason, new RegExp(String.raw`^self-review: the agent's changes were refused: outside the signed scope: unreported\.txt${KEPT}$`));
    assert.ok(!existsSync(join(worktreePath, "unreported.txt")), "the worktree is reset to the last phase's commit");
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
          `base=${phaseHead}; discarded=none; reason=self-review: dispatch failed: prompt exceeds ${PROMPT_MAX_BYTES} bytes`,
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
      `self-review: compute diff: the worktree head moved from ${phaseHead} to ${moved} while the agent ran; the worktree is kept as evidence`
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
    assert.ok(prompt.includes(`The repository checkout is at commit ${phaseHead}, `));
    assert.equal(rows[1]!.input_hash, sha256Hex(prompt), "the stage sent the self-review built on the last phase's commit");
  });
});

// --- derived artifacts (docs/features/derived-artifacts-and-dependency-policy/plan.md) ---

/** A lockfile the system regenerates, written by a fixture command with fixed content. */
const DERIVED_VERIFICATION: VerificationConfig = {
  commands: VERIFICATION.commands,
  derived: [
    {
      name: "lockfile",
      path: "package-lock.json",
      command: ["node", join(process.cwd(), "test", "fixtures", "verify", "write-derived.mjs"), "package-lock.json", "v2"],
    },
  ],
};

test("each phase is followed by a regeneration: the file is committed once, the gate head is the tip, and the self-review never sees it", async () => {
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, head, worktreePath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        if (!result.ok) return;

        // Phase 1 creates the file; phase 2's command writes the same bytes.
        const applies = auditSummaries(store, runId, "implementation.phase.apply");
        assert.equal(applies.length, 2);
        const phase1Head = /head=([0-9a-f]+);/.exec(applies[0]!)![1]!;
        const commits = auditSummaries(store, runId, "implementation.derived.commit");
        assert.equal(commits.length, 1);
        const regenerated = /head=([0-9a-f]+);/.exec(commits[0]!)![1]!;
        assert.ok(commits[0]!.startsWith(`label=phase-1; base=${phase1Head}; head=${regenerated}; paths=package-lock.json; `), commits[0]);
        assert.equal(git(worktreePath, ["rev-parse", `${regenerated}~1`]).stdout.trim(), phase1Head);
        assert.equal(git(worktreePath, ["diff", "--name-only", phase1Head, regenerated]).stdout.trim(), "package-lock.json");
        // Phase 2 proposed against the regenerated commit.
        assert.match(applies[1]!, new RegExp(`; base=${regenerated}; `));
        const unchanged = auditSummaries(store, runId, "implementation.derived.unchanged");
        assert.equal(unchanged.length, 1);
        assert.ok(unchanged[0]!.startsWith(`label=phase-2; head=${lastPhaseHead(store, runId)}; `), unchanged[0]);

        const messages = git(worktreePath, ["log", "--format=%s", `${head}..HEAD`]).stdout.trim().split("\n");
        assert.equal(messages.length, 4, "projections, phase 1, its regeneration, phase 2");
        assert.equal(messages[1], `bw run ${runId}: regenerate derived artifacts (phase-1, base ${phase1Head.slice(0, 8)})`);
        assert.equal(gateHandoff(store, runId).head, git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim());
        assert.equal(readFileSync(join(worktreePath, "package-lock.json"), "utf8"), "v2\n");

        // The self-review's changed paths and diff leave the derived file out.
        const selfReview = store.query<{ input_hash: string }>(
          "SELECT ar.input_hash FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? ORDER BY ar.id DESC LIMIT 1",
          [runId]
        )[0]!;
        const prompt = readFileSync(join(root, ".governance", "prompts", String(runId), `${selfReview.input_hash}.txt`), "utf8");
        const listed = prompt.slice(prompt.indexOf("Changed paths:\n\n") + "Changed paths:\n\n".length, prompt.indexOf("\n\nApproved plan:"));
        assert.equal(listed, "- src/p1.ts\n- src/p2.ts");
        assert.ok(!prompt.includes("diff --git a/package-lock.json"), "the diff omits the derived file");
        assert.equal(verifyAuditChain(store), null);
      },
      { plan: tasksPlan(20), scope: phaseScope(2), verification: DERIVED_VERIFICATION }
    );
  }, "phased");
});

test("a self-review fix is followed by a regeneration, and the gate head is the regenerated commit", async () => {
  const mirror: VerificationConfig = {
    commands: VERIFICATION.commands,
    derived: [
      {
        name: "lockfile",
        path: "package-lock.json",
        command: ["node", join(process.cwd(), "test", "fixtures", "verify", "write-derived.mjs"), "package-lock.json", "@src/a1.ts"],
      },
    ],
  };
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId, worktreePath }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        const commits = auditSummaries(store, runId, "implementation.derived.commit");
        assert.deepEqual(commits.map((c) => /^label=([^;]+);/.exec(c)![1]), ["phase-1", "self-review"]);
        const tip = git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();
        assert.ok(commits[1]!.includes(`; head=${tip}; `), commits[1]);
        // projections, phase 1, its regeneration, the self-review fix, its regeneration
        const selfReviewCommit = git(worktreePath, ["rev-parse", "HEAD~1"]).stdout.trim();
        const selfReviewBase = git(worktreePath, ["rev-parse", "HEAD~2"]).stdout.trim();
        assert.ok(commits[0]!.includes(`; head=${selfReviewBase}; `), "the self-review proposed on the regenerated commit");
        assert.equal(
          auditSummaries(store, runId, "implementation.selfreview.pass")[0],
          `critique=1; recorded=1; changed=${SCOPE[0]}; base=${selfReviewBase}; head=${tip}`
        );
        assert.ok(commits[1]!.startsWith(`label=self-review; base=${selfReviewCommit}; `), commits[1]);
        assert.equal(gateHandoff(store, runId).head, tip);
        assert.equal(
          readFileSync(join(worktreePath, "package-lock.json"), "utf8"),
          readFileSync(join(worktreePath, "src", "a1.ts"), "utf8")
        );
      },
      { verification: mirror }
    );
  }, "self-review-fix");
});

test("a regeneration that fails blocks the run at that phase, before the next phase is dispatched", async () => {
  const failing: VerificationConfig = {
    commands: VERIFICATION.commands,
    derived: [
      {
        name: "lockfile",
        path: "package-lock.json",
        command: ["node", join(process.cwd(), "test", "fixtures", "verify", "exit-two.mjs")],
      },
    ],
  };
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(
          result.reason,
          "phase 1 of 2: derived artifact lockfile could not be regenerated: the command exited with code 2"
        );
        assert.deepEqual(auditSummaries(store, runId, "implementation.derived.failed"), [result.reason]);
        assert.equal(auditSummaries(store, runId, "implementation.derived.fail").length, 1);
        assert.equal(agentRunCount(store, runId), 1, "phase 2 was never dispatched");
        assert.equal(store.getRun(runId)!.status, "blocked");
      },
      { plan: tasksPlan(20), scope: phaseScope(2), verification: failing }
    );
  }, "phased");
});

/** SPEC declaring a package.json, with or without the package the add-dependency mode adds. */
function dependencySpec(listed: boolean): string {
  return `feature: demo
change_kind: feature

## Declared artifacts

- package.json

## Acceptance criteria

- AC-001: the thing works
- AC-002: it is observable
- AC-003: it stays working
${listed ? "\n## Dependencies added\n\n- package.json: @tiptap/react\n" : ""}`;
}

test("a phase adding a package the signed specification does not list blocks the run, and nothing is regenerated after it", async () => {
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(
          result.reason,
          "the change adds package(s) the approved specification does not list under ## Dependencies added: package.json:@tiptap/react"
        );
        assert.deepEqual(auditSummaries(store, runId, "implementation.dependency.unapproved"), [result.reason]);
        assert.equal(auditActionCount(store, runId, "implementation.phase.apply"), 1, "the check runs on the committed phase");
        assert.equal(
          store.query<{ n: number }>("SELECT COUNT(*) AS n FROM audit WHERE run_id = ? AND action LIKE 'implementation.derived.%'", [runId])[0]!.n,
          0,
          "no regeneration ran after the refusal"
        );
        assert.equal(agentRunCount(store, runId), 1, "the self-review was never dispatched");
        assert.equal(store.getRun(runId)!.status, "blocked");
      },
      { spec: dependencySpec(false), scope: ["package.json"], verification: DERIVED_VERIFICATION }
    );
  }, "add-dependency");
});

test("a phase adding the package the signed specification lists passes", async () => {
  await withMode(async () => {
    await withApprovedRun(
      async ({ store, root, runId }) => {
        const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
        assert.equal(result.ok, true, (result as { reason?: string }).reason);
        assert.equal(auditActionCount(store, runId, "implementation.dependency.unapproved"), 0);
      },
      { spec: dependencySpec(true), scope: ["package.json"] }
    );
  }, "add-dependency");
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

// --- the acceptance suite (docs/features/protected-acceptance-tests/plan.md, Task 6) ---

const ACCEPTANCE = { dir: `acceptance/${SLUG}/`, repeatEach: 2 };
const SUITE_FILE = `${ACCEPTANCE.dir}acceptance.spec.mjs`;

/**
 * The one test title in a recorded acceptance report. The stand-in runs no
 * browser and answers the gate run with that report, so the specification's one
 * criterion is the one its test names, and the emitter titles its test from it.
 */
function recordedTitle(report: string): { title: string; id: string } {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), "test", "fixtures", "recorded", `acceptance-report-${report}.json`), "utf8")
  ) as { log: string };
  const read = readAcceptanceReport(fixture.log);
  assert.ok(read.ok, read.ok ? "" : read.reason);
  const titles = [...new Set(read.report.tests.map((t) => t.title))];
  assert.equal(titles.length, 1, `${report} holds one test`);
  return { title: titles[0]!, id: /^(AC-\d+) /.exec(titles[0]!)![1]! };
}

/** A run parked for implementation with `profile.acceptance` frozen on and the gate run served `report`. */
function withAcceptanceRun(
  report: string,
  fn: (ctx: Ctx) => Promise<void>,
  opts: { baseFiles?: Record<string, string>; scope?: string[] } = {}
): Promise<void> {
  const { title, id } = recordedTitle(report);
  return withApprovedRun(
    async (ctx) => {
      const path = join(ctx.root, ".governance", "profiles", String(ctx.runId), "profile.json");
      const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      profile.acceptance = ACCEPTANCE;
      const serialized = canonicalJson(profile);
      writeFileSync(path, serialized);
      ctx.store.setProfileRef(ctx.runId, sha256Hex(serialized));
      const unserve = serveAcceptanceReport(sandboxPrefix(ctx.root, ctx.runId, "acceptance-gate"), report);
      try {
        await fn(ctx);
      } finally {
        unserve();
      }
    },
    {
      spec: SPEC.replace(/## Acceptance criteria\n\n[\s\S]*$/, `## Acceptance criteria\n\n- ${id}: ${title.slice(id.length + 1)}\n`),
      plan: (specHash) => `feature: demo\nplan_for: ${specHash}\n\n## Tasks\n\n- Build the thing\n\n## Coverage\n\n- ${id} -> src/a1.ts\n`,
      ...opts,
    }
  );
}

function gateRecord(root: string, runId: number): { ok: boolean; baseline: string; refusals: string[]; tests: { criterion: string; role: string; failureClass: string | null }[] } {
  return JSON.parse(readFileSync(join(root, ".governance", "acceptance", String(runId), "gate.json"), "utf8"));
}

test("a suite that passes the validity gate is committed before phase 1, and phase 1 proposes on the suite commit", async () => {
  await withAcceptanceRun("valid-red-matcher", async ({ store, root, runId, worktreePath }) => {
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const projections = projectionsHead(store, runId, worktreePath);
    const authored = auditSummaries(store, runId, "implementation.acceptance.authored");
    assert.equal(authored.length, 1);
    const suite = /head=([0-9a-f]+);/.exec(authored[0]!)![1]!;
    assert.equal(authored[0], `base=${projections}; head=${suite}; paths=${SUITE_FILE}`);
    assert.equal(git(worktreePath, ["rev-parse", `${suite}~1`]).stdout.trim(), projections, "the suite commit follows the projections");
    assert.equal(git(worktreePath, ["diff", "--name-only", projections, suite]).stdout.trim(), SUITE_FILE);
    // Phase 1 proposes on the suite commit, which is also the handoff base, so
    // the implementation diff never holds the suite.
    assert.match(auditSummaries(store, runId, "implementation.phase.apply")[0]!, new RegExp(`^phase 1 of 1: tasks 1-1; base=${suite}; `));
    assert.equal(gateHandoff(store, runId).base, suite);
    const settings = store.query<{ setting: string; role: string }>(
      "SELECT ar.setting, ar.role FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? ORDER BY ar.id",
      [runId]
    );
    assert.deepEqual(settings.map((r) => r.setting), ["acceptance-test-author", "implementer", "implementer"]);
    assert.deepEqual(auditSummaries(store, runId, "implementation.acceptance.gate.pass"), [
      `suite=${suite}; tests=1; red=1; guards=0; alreadySatisfied=none; record=${join(".governance", "acceptance", String(runId), "gate.json")}`,
    ]);
    const record = gateRecord(root, runId);
    assert.equal(record.ok, true);
    assert.deepEqual(record.refusals, []);
    assert.deepEqual(record.tests.map((t) => [t.criterion, t.role, t.failureClass]), [[recordedTitle("valid-red-matcher").id, "red", "valid_red"]]);

    // The base commit holds no index.html, so the gate ran once, in the
    // throwaway checkout holding the stub, and that checkout is gone.
    const baseline = join(root, ".governance", "acceptance", String(runId), "baseline");
    assert.equal(record.baseline, "the suite commit with the blank stub page");
    const runs = acceptanceRuns(sandboxPrefix(root, runId, "acceptance-gate"));
    assert.equal(runs.length, 1);
    assert.equal(resolve(runs[0]!.cwd), resolve(baseline));
    assert.equal(runs[0]!.indexHtml, ACCEPTANCE_STUB_PAGE);
    assert.equal(existsSync(baseline), false, "the baseline checkout was removed");
    assert.ok(!git(root, ["worktree", "list", "--porcelain"]).stdout.includes("baseline"), "and unregistered");
    assert.equal(auditActionCount(store, runId, "implementation.acceptance.baseline.cleanup.failed"), 0);
    assert.equal(existsSync(join(worktreePath, "index.html")), false, "the run worktree never holds the stub");
    assert.ok(!git(worktreePath, ["log", "--format=%s"]).stdout.includes("stub page"), "nor does the run branch");
    assert.equal(git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]).stdout, "");
    assert.equal(verifyAuditChain(store), null);
  });
});

test("a suite commit that already holds index.html is gated in the run worktree, with no baseline checkout", async () => {
  const page = "<!doctype html><title>existing</title>\n";
  await withAcceptanceRun(
    "valid-red-matcher",
    async ({ store, root, runId, worktreePath }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, true, (result as { reason?: string }).reason);
      const runs = acceptanceRuns(sandboxPrefix(root, runId, "acceptance-gate"));
      assert.equal(runs.length, 1);
      assert.equal(resolve(runs[0]!.cwd), resolve(worktreePath));
      assert.equal(runs[0]!.indexHtml, page);
      assert.equal(gateRecord(root, runId).baseline, "the suite commit");
      assert.equal(existsSync(join(root, ".governance", "acceptance", String(runId), "baseline")), false);
    },
    { baseFiles: { "index.html": page } }
  );
});

for (const [report, broken] of [
  ["navigation", "is broken (navigation)"],
  ["flaky", "is flaky"],
] as const) {
  test(`a suite the validity gate refuses blocks the run with every refusal, and no phase is dispatched (${report})`, async () => {
    const { id } = recordedTitle(report);
    await withAcceptanceRun(report, async ({ store, root, runId, worktreePath }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      const record = gateRecord(root, runId);
      assert.equal(record.ok, false);
      assert.equal(result.reason, `acceptance: the suite fails the validity gate: ${record.refusals.join("; ")}`);
      assert.ok(record.refusals.some((r) => r.includes(broken)), record.refusals.join(" | "));
      assert.ok(record.refusals.includes(`criterion ${id} has neither a valid red test nor a passing guard`), record.refusals.join(" | "));
      assert.deepEqual(auditSummaries(store, runId, "implementation.acceptance.gate.block"), [result.reason]);
      assert.equal(agentRunCount(store, runId), 1, "only the test author was dispatched");
      assert.equal(auditActionCount(store, runId, "implementation.phase.apply"), 0);
      assert.equal(auditActionCount(store, runId, "implementation.acceptance.gate.pass"), 0);
      const stage = store.getStageChain(runId).find((s) => s.kind === "implementation")!;
      assert.equal(stage.status, "blocked");
      assert.equal(store.getRun(runId)!.status, "blocked");
      // The refused suite stays committed on the branch as evidence.
      const authored = auditSummaries(store, runId, "implementation.acceptance.authored");
      assert.equal(git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim(), /head=([0-9a-f]+);/.exec(authored[0]!)![1]);
      assert.equal(existsSync(join(root, ".governance", "acceptance", String(runId), "baseline")), false);
    });
  });
}

test("a test author that writes outside the suite directory is refused by name, and nothing is gated", async () => {
  await withMode(async () => {
    await withAcceptanceRun("valid-red-matcher", async ({ store, root, runId, worktreePath }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(
        result.reason,
        new RegExp(String.raw`^acceptance: the agent's changes were refused: outside the signed scope: src\/never-approved\.ts${KEPT}$`)
      );
      assert.deepEqual(auditSummaries(store, runId, "implementation.acceptance.refused"), [result.reason]);
      assert.equal(auditActionCount(store, runId, "implementation.acceptance.authored"), 0);
      assert.equal(agentRunCount(store, runId), 1);
      assert.equal(acceptanceRuns(sandboxPrefix(root, runId, "acceptance-gate")).length, 0, "no gate run");
      assert.equal(git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim(), projectionsHead(store, runId, worktreePath));
      assert.equal(git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]).stdout, "");
      assert.equal(store.getRun(runId)!.status, "blocked");
    });
  }, "test-author-outside");
});

test("a run without an acceptance suite dispatches and audits exactly what it did before the suite existed", async () => {
  // The actions and the dispatch rows the success path recorded at commit
  // 4be6b2a, before Task 6 (2026-10-21). A scratch comparison of that commit
  // against this tree also matched every normalized summary and prompt of this
  // path, an out-of-scope refusal and a self-review fix (plan, Task 6 record).
  await withApprovedRun(async ({ store, root, runId }) => {
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    assert.deepEqual(
      store.query<{ action: string }>("SELECT action FROM audit WHERE run_id = ? ORDER BY id", [runId]).map((r) => r.action),
      [
        "spec.gate.pass",
        "plan.gate.pass",
        "implementation.stage.create",
        "implementation.worktree.create",
        "implementation.projections.commit",
        "agent.dispatch",
        "implementation.phase.apply",
        "agent.dispatch",
        "implementation.selfreview.critique",
        "implementation.selfreview.pass",
        "implementation.gate.pass",
      ]
    );
    assert.deepEqual(
      store
        .query<{ agent: string; role: string; setting: string; requested_model: string; requested_effort: string }>(
          "SELECT ar.agent, ar.role, ar.setting, ar.requested_model, ar.requested_effort FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? ORDER BY ar.id",
          [runId]
        )
        .map((r) => [r.agent, r.role, r.setting, r.requested_model, r.requested_effort]),
      [
        ["implementer", "author", "implementer", "m", "medium"],
        ["implementer", "author", "implementer", "m", "medium"],
      ]
    );
    assert.equal(acceptanceRuns(sandboxPrefix(root, runId, "acceptance-gate")).length, 0);
    assert.equal(existsSync(join(root, ".governance", "acceptance")), false);
  });
});

// --- the suite read-only after its author (docs/features/protected-acceptance-tests/plan.md, Task 7) ---

/** Freeze a recording stand-in into the run's profile; the reader returns every Docker call's argv. */
function recordDockerCalls(store: Store, root: string, runId: number, dir: string): () => string[][] {
  const recording = recordingDockerCommand(dir);
  const path = join(root, ".governance", "profiles", String(runId), "profile.json");
  const profile = JSON.parse(readFileSync(path, "utf8")) as { sandbox: { dockerCommand: string[] } };
  profile.sandbox.dockerCommand = recording.dockerCommand;
  const serialized = canonicalJson(profile);
  writeFileSync(path, serialized);
  store.setProfileRef(runId, sha256Hex(serialized));
  return recording.calls;
}

/** The two mounts every work container gets. */
function baseMounts(tree: string): string[] {
  return [`${tree}:/work`, `${join(tree, ".git")}:/work/.git:ro`];
}

test("after its author, the suite is mounted read-only into the gate run, every phase and the self-review", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bw-docker-argv-"));
  try {
    await withAcceptanceRun("valid-red-matcher", async ({ store, root, runId, worktreePath }) => {
      const calls = recordDockerCalls(store, root, runId, dir);
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, true, (result as { reason?: string }).reason);
      const started = workContainerMounts(calls());
      const of = (label: string) => started.filter((s) => s.name.startsWith(sandboxPrefix(root, runId, label)));
      // With a suite, each mount is the committed copy beside the worktree, never the worktree (Task 12).
      const withSuite = (label: string, tree: string) => of(label).map((s) => [...baseMounts(tree), committedSuiteMount(root, runId, s.name, ACCEPTANCE.dir)]);
      assert.deepEqual(of("test-author").map((s) => s.mounts), [baseMounts(worktreePath)], "the author writes the suite");
      const baseline = join(root, ".governance", "acceptance", String(runId), "baseline");
      assert.deepEqual(of("acceptance-gate").map((s) => s.mounts), withSuite("acceptance-gate", baseline));
      assert.deepEqual(of("phase-1").map((s) => s.mounts), withSuite("phase-1", worktreePath));
      assert.deepEqual(of("self-review").map((s) => s.mounts), withSuite("self-review", worktreePath));
      assert.equal(started.length, 4, started.map((s) => s.name).join(", "));
      // Teardown removed every copy.
      assert.deepEqual(readdirSync(join(root, ".governance", "acceptance", String(runId), "mounts")), []);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a run without a suite mounts only the worktree and its read-only .git into every container", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bw-docker-argv-"));
  try {
    await withApprovedRun(async ({ store, root, runId, worktreePath }) => {
      const calls = recordDockerCalls(store, root, runId, dir);
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, true, (result as { reason?: string }).reason);
      const started = workContainerMounts(calls());
      assert.equal(started.length, 2, "the phase and the self-review");
      for (const container of started) assert.deepEqual(container.mounts, baseMounts(worktreePath), container.name);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a phase that changes the suite is refused naming it, kept as a commit, and the worktree is reset to the suite commit", async () => {
  // The suite file is inside the signed scope here, so only the boundary's
  // acceptance-suite cause can refuse it.
  await withMode(
    async () => {
      await withAcceptanceRun(
        "valid-red-matcher",
        async ({ store, root, runId, worktreePath }) => {
          const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
          assert.equal(result.ok, false);
          if (result.ok) return;
          assert.match(
            result.reason,
            new RegExp(String.raw`^the agent's changes were refused: changes ${SUITE_FILE.replace(/[./]/g, "\\$&")} in the acceptance suite: the system refuses agent edits to it${KEPT}$`)
          );
          assert.deepEqual(auditSummaries(store, runId, "implementation.workspace.refused"), [result.reason]);
          const suite = /head=([0-9a-f]+);/.exec(auditSummaries(store, runId, "implementation.acceptance.authored")[0]!)![1]!;
          assert.equal(git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim(), suite);
          assert.equal(git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]).stdout, "");
          const kept = new RegExp(KEPT).exec(result.reason)![1]!;
          assert.equal(git(worktreePath, ["diff", "--name-only", suite, kept]).stdout.trim(), SUITE_FILE);
          assert.equal(git(worktreePath, ["rev-parse", "--verify", `refs/buildworks/refused/${kept}`]).stdout.trim(), kept);
        },
        { scope: [...SCOPE, SUITE_FILE] }
      );
    },
    "protected",
    SUITE_FILE
  );
});

// --- the suite in the implementer's prompts (docs/features/protected-acceptance-tests/plan.md, Task 9) ---

test("a phase that returns blocked naming a suite test's title records the dispute, and the run still blocks", async () => {
  const { title } = recordedTitle("valid-red-matcher");
  await withMode(async () => {
    await withAcceptanceRun("valid-red-matcher", async ({ store, root, runId }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(
        result.reason,
        `implementer returned status blocked, not completed: fixture disputes a test; incomplete: ${title}: the test contradicts the approved specification`
      );
      assert.deepEqual(auditSummaries(store, runId, "implementation.acceptance.disputed"), [`tests=${title}`]);
      assert.deepEqual(auditSummaries(store, runId, "implementation.author.failed"), [result.reason]);
      assert.equal(store.getRun(runId)!.status, "blocked");
    });
  }, "dispute");
});

test("a blocked phase that names only a criterion's ID records no dispute", async () => {
  await withMode(async () => {
    await withAcceptanceRun("valid-red-matcher", async ({ store, root, runId }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /^implementer returned status blocked, not completed: fixture could not finish; incomplete: AC-\d+: could not be implemented$/);
      assert.equal(auditActionCount(store, runId, "implementation.acceptance.disputed"), 0);
    });
  }, "dispute-id-only");
});

test("a self-review that returns blocked naming a suite test's title records the dispute and is skipped", async () => {
  const { title } = recordedTitle("valid-red-matcher");
  await withMode(async () => {
    await withAcceptanceRun("valid-red-matcher", async ({ store, root, runId }) => {
      const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, true, (result as { reason?: string }).reason);
      assert.deepEqual(auditSummaries(store, runId, "implementation.acceptance.disputed"), [`self-review: tests=${title}`]);
      assert.equal(auditSummaries(store, runId, "implementation.selfreview.skipped").length, 1);
      assert.equal(gateHandoff(store, runId).head, lastPhaseHead(store, runId));
    });
  }, "self-review-dispute");
});

test("with a suite, the phase and self-review prompts the stage sent carry the suite's directory and command", async () => {
  await withAcceptanceRun("valid-red-matcher", async ({ store, root, runId }) => {
    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const rows = store.query<{ input_hash: string }>(
      "SELECT ar.input_hash FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? AND ar.setting = 'implementer' ORDER BY ar.id",
      [runId]
    );
    assert.equal(rows.length, 2, "the phase and the self-review");
    for (const row of rows) {
      const prompt = readFileSync(join(root, ".governance", "prompts", String(runId), `${row.input_hash}.txt`), "utf8");
      assert.ok(prompt.includes(`wrote the acceptance suite under ${ACCEPTANCE.dir} from the approved specification's`), "the suite's directory");
      const command = acceptanceCommand(ACCEPTANCE.dir, ACCEPTANCE.repeatEach).command.join(" ");
      assert.ok(prompt.includes(`Run the suite yourself through run_command with this command: ${command}`), "the suite's command");
      assert.ok(prompt.includes("list the test's exact title in incompleteTasks"));
    }
  });
});
