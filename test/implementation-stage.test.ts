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
import { freezeProfile } from "../src/profile.ts";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { validateAgentResult } from "../src/agent-result.ts";
import type { ExecutorDefinition } from "../src/executor.ts";

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

- the thing works
- it is observable
- it stays working
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
      envPassthrough: ["PATH", "SystemRoot", "TEMP", "TMP", "EMIT_MODE", "EMIT_PATH"],
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

async function withMode(fn: () => Promise<void>, mode: string, emitPath?: string): Promise<void> {
  const beforeMode = process.env.EMIT_MODE;
  const beforePath = process.env.EMIT_PATH;
  process.env.EMIT_MODE = mode;
  if (emitPath !== undefined) process.env.EMIT_PATH = emitPath;
  try {
    await fn();
  } finally {
    if (beforeMode === undefined) delete process.env.EMIT_MODE;
    else process.env.EMIT_MODE = beforeMode;
    if (beforePath === undefined) delete process.env.EMIT_PATH;
    else process.env.EMIT_PATH = beforePath;
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
  opts: { scope?: string[]; approval?: boolean; spec?: string; gitignore?: string } = {}
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-implementation-"));
  const store = openStore(root);
  try {
    const init = git(root, ["init", "-q"]);
    assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
    writeFileSync(join(root, "base.txt"), BASE_MARKER);
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
    const frozen = freezeProfile(root, run.id, head, MODEL);
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
    const plan = `feature: demo
plan_for: ${specHash}

## Tasks

- Build the thing
- Test the thing

## Coverage

- the thing works -> src/a1.ts
- it is observable -> not_applicable: observed at runtime, not asserted / checked in the smoke run's recorded output
- it stays working -> test/a1.test.ts
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

test("a profile with no implementation model fails at configuration time, before dispatch", async () => {
  await withApprovedRun(async ({ store, root, runId }) => {
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as { modelMap: Record<string, string> };
    delete profile.modelMap.implementation;
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));

    const result = await runImplementationStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /no model configured for stage implementation/);
    assert.equal(agentRunCount(store, runId), 0, "the failure precedes the invocation");
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
    const run = spawnSync("node", [FIXTURE], { cwd: scratch, input: prompt, encoding: "utf8", env });
    assert.equal(run.status, 0, run.stderr);
    const envelope = JSON.parse(run.stdout) as { result: string };
    const body = JSON.parse(envelope.result) as unknown;
    const verdict = validateAgentResult("implementer", body);
    assert.equal(verdict.ok, true, verdict.ok ? "" : verdict.reason);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
