import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import {
  codeReviewGate,
  runCodeReviewStage,
  validateCodeReviewLocations,
  type CodeReviewRecord,
} from "../src/code-review-stage.ts";
import { runVerificationStage } from "../src/verification-stage.ts";
import { extractJsonBody } from "../src/parse-output.ts";
import { validateAgentResult } from "../src/agent-result.ts";
import { upstreamPrefixFor, validateReviewerReports } from "../src/reconciliation.ts";
import { freezeProfile, loadProfile, type Profile } from "../src/profile.ts";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { policyHash } from "../src/policy.ts";
import { codeReviewEvidenceRef, proposalEvidenceRef } from "../src/paths.ts";
import type { ExecutorDefinition } from "../src/executor.ts";
import type { VerificationConfig } from "../src/governed-config.ts";

/** A passing command whose fixture writes nothing, so the worktree stays clean. */
const VERIFICATION: VerificationConfig = {
  commands: [
    { name: "ok", command: ["node", join(process.cwd(), "test", "fixtures", "verify", "exit-zero.mjs")] },
  ],
};
const FIXTURE = join(process.cwd(), "test", "fixtures", "harness", "emit-code-review.mjs");
const MODEL = "m";
const SLUG = "demo";
const ARTIFACT = "src/a1.ts";
/**
 * The content committed as `base.txt` at the run's base commit, so it is what
 * the *worktree* holds. The root's copy is overwritten with something else
 * once the worktree exists, which is what makes the fixture's read of
 * `base.txt` a proof of its working directory rather than a coincidence.
 */
const WORKTREE_MARKER = "worktree-base-marker";
const ROOT_MARKER = "root-only-never-the-worktree";

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function commitIn(cwd: string, message: string): void {
  const commit = git(cwd, [
    "-c",
    "user.email=buildworks@buildworks.invalid",
    "-c",
    "user.name=BuildWorks",
    "commit",
    "-q",
    "-m",
    message,
  ]);
  assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
}

/**
 * The fixture stands in for the claude-code executor. `EMIT_MODE` is in the
 * *executor's* passthrough, not the test's: the stage invokes the harness
 * with the frozen executor's environment, so a mode set only in the test
 * process would never reach the fixture.
 */
function fixtureExecutor(
  scriptPath: string,
  capabilities: string[] = ["spec", "plan", "review", "implementation"]
): ExecutorDefinition {
  return {
    id: "claude-code",
    command: ["node", scriptPath],
    probe: ["node", "--version"],
    capabilities,
    telemetry: { perInvocationModel: true, effectiveModel: true, tokenUsage: true, sessionCost: true },
    sandbox: {
      allowedPaths: [],
      deniedPaths: [],
      commandAllowlist: [],
      idleTimeoutSeconds: 30,
      absoluteTimeoutSeconds: 120,
      envPassthrough: ["PATH", "SystemRoot", "TEMP", "TMP", "EMIT_MODE"],
      network: "inherit",
    },
  };
}

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

/** Mutate the frozen profile and re-record its hash, as the run had frozen it. */
function refreeze(root: string, store: Store, runId: number, mutate: (p: Profile) => void): void {
  const { profile } = loadProfile(root, runId);
  mutate(profile);
  // `policyHash` is recomputed: the profile validity check refuses a profile
  // whose recorded hash does not describe its own policy, so a mutation that
  // skipped this would be refused for the wrong reason.
  profile.policyHash = policyHash(profile.policy);
  const serialized = canonicalJson(profile);
  writeFileSync(join(root, ".governance", "profiles", String(runId), "profile.json"), serialized);
  store.setProfileRef(runId, sha256Hex(serialized));
}

async function withMode(fn: () => Promise<void>, mode: string): Promise<void> {
  const before = process.env.EMIT_MODE;
  process.env.EMIT_MODE = mode;
  try {
    await fn();
  } finally {
    if (before === undefined) delete process.env.EMIT_MODE;
    else process.env.EMIT_MODE = before;
  }
}

interface Ctx {
  store: Store;
  root: string;
  runId: number;
  startingCommit: string;
  verifiedCommit: string;
  patchBase: string;
  worktreePath: string;
  planPath: string;
  specPath: string;
  implementationStageId: number;
  verificationStageId: number | null;
}

interface Opts {
  /** Files committed on the run branch between the patch base and the verified head. */
  commitFiles?: string[];
  /** Stop after implementation, so the last stage is not a passed verification. */
  implementationOnly?: boolean;
  /** Freeze this executor instead of the default fixture one. */
  executor?: ExecutorDefinition;
  /**
   * Complete the verification stage by hand without its gate event — the only
   * state in which the missing-event refusal is reachable, since the real
   * stage always appends the event and the store refuses to delete one
   * (`audit is append-only`).
   */
  noVerificationGateEvent?: boolean;
  /** Omit the plan gate event, for the same reason. */
  noPlanGateEvent?: boolean;
}

/**
 * A run parked at the code-review boundary through the real stages:
 * real git repository, real worktree on the run branch, the run's spec and
 * plan projections committed on the branch first, a commit of the declared
 * files, the implementation gate event recording both commits, and a real
 * verification stage run to completion — so the record this stage re-reads
 * exists and was written by the shipped code.
 *
 * The plan and its gate event are set up the way `runImplementationStage`
 * expects to find them, because this stage re-verifies both hashes at its own
 * boundary. `README.md` is committed at the base and never changed, so the
 * `unchanged-path` fixture mode names a real file that is outside the changed
 * set rather than a file that does not exist.
 */
async function withVerifiedRun(fn: (ctx: Ctx) => Promise<void>, opts: Opts = {}): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-code-review-"));
  const store = openStore(root);
  try {
    const init = git(root, ["init", "-q"]);
    assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
    writeFileSync(join(root, ".gitignore"), ".governance/\n");
    writeFileSync(join(root, "base.txt"), `${WORKTREE_MARKER}\n`);
    writeFileSync(join(root, "README.md"), "# demo\n");
    const addBase = git(root, ["add", "-A"]);
    assert.equal(addBase.status, 0, `git add failed: ${addBase.stderr}`);
    commitIn(root, "base");
    const head = git(root, ["rev-parse", "HEAD"]).stdout.trim();

    const run = store.insertRun("p", "f-1", SLUG, "feature");
    const frozen = freezeProfile(root, run.id, head, MODEL, VERIFICATION);
    store.setProfileRef(run.id, frozen.hash);
    freezeExecutorIntoProfile(store, root, run.id, opts.executor ?? fixtureExecutor(FIXTURE));

    const scope = [ARTIFACT];
    const specPath = join(root, "docs", "features", SLUG, "spec.md");
    mkdirSync(dirname(specPath), { recursive: true });
    const spec = `feature: demo
change_kind: feature

## Declared artifacts

${scope.map((p) => `- ${p}`).join("\n")}

## Acceptance criteria

- AC-001: the artifact is committed
`;
    writeFileSync(specPath, spec);
    const specHash = sha256Hex(normalizeText(spec));
    const specStage = store.insertStage(run.id, "spec", null);
    store.completeStage(specStage.id, specPath, "pass");
    const specReviewStage = store.insertStage(run.id, "spec_review", specStage.id);
    store.completeStage(specReviewStage.id, specPath, "pass");
    appendAudit(store, {
      runId: run.id,
      stageId: specReviewStage.id,
      actor: "system",
      actorType: "cli",
      action: "spec.gate.pass",
      summary: `spec_review gate passed in round 1; specHash=${specHash}; risk=low`,
    });
    const approvalStage = store.insertStage(run.id, "awaiting_approval", specReviewStage.id);
    store.completeStage(approvalStage.id, specPath, "pass");
    store.insertApproval({
      runId: run.id,
      featureId: "f-1",
      specHash,
      startingCommit: head,
      profileHash: frozen.hash,
      risk: "low",
      scope: canonicalJson(scope),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      signature: "sig",
      signer: "signer",
    });

    // The plan and the gate event, in the shape runImplementationStage's
    // regex parses — this stage re-verifies both at its own boundary.
    const planPath = join(root, "docs", "features", SLUG, "plan.md");
    const plan = `# demo plan

## Tasks

- Task 1: write the artifact
`;
    writeFileSync(planPath, plan);
    const planHash = sha256Hex(normalizeText(plan));
    const planStage = store.insertStage(run.id, "plan", approvalStage.id);
    store.completeStage(planStage.id, planPath, "pass");
    const planReviewStage = store.insertStage(run.id, "plan_review", planStage.id);
    store.completeStage(planReviewStage.id, planPath, "pass");
    if (opts.noPlanGateEvent !== true) {
      appendAudit(store, {
        runId: run.id,
        stageId: planReviewStage.id,
        actor: "system",
        actorType: "cli",
        action: "plan.gate.pass",
        summary: `plan_review gate passed in round 1; planHash=${planHash}; planFor=${specHash}`,
      });
    }

    const worktreePath = join(root, ".governance", "worktrees", String(run.id));
    const added = git(root, ["worktree", "add", "-q", worktreePath, "-b", `gov/${SLUG}/${run.id}`, head]);
    assert.equal(added.status, 0, `git worktree add failed: ${added.stderr}`);

    // The root's own base.txt is overwritten *after* the worktree exists, so
    // the two trees disagree. A fixture that read the root would report the
    // other marker, which is what makes the cwd assertion a proof.
    writeFileSync(join(root, "base.txt"), `${ROOT_MARKER}\n`);

    const projectedDocs = [`docs/features/${SLUG}/spec.md`, `docs/features/${SLUG}/plan.md`];
    for (const file of projectedDocs) {
      const target = join(worktreePath, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `projected ${file}\n`);
    }
    const addProjections = git(worktreePath, ["--literal-pathspecs", "add", "--", ...projectedDocs]);
    assert.equal(addProjections.status, 0, `git add failed: ${addProjections.stderr}`);
    commitIn(worktreePath, `bw run ${run.id}: project spec and plan`);
    const patchBase = git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();

    const commitFiles = opts.commitFiles ?? scope;
    for (const file of commitFiles) {
      const target = join(worktreePath, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `content of ${file}\n`);
    }
    if (commitFiles.length > 0) {
      const addPatch = git(worktreePath, ["--literal-pathspecs", "add", "--", ...commitFiles]);
      assert.equal(addPatch.status, 0, `git add failed: ${addPatch.stderr}`);
      commitIn(worktreePath, `bw run ${run.id}: apply patch`);
    }
    const verifiedCommit = git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();

    const implementationStage = store.insertStage(run.id, "implementation", planReviewStage.id);
    store.completeStage(implementationStage.id, worktreePath, "pass");
    appendAudit(store, {
      runId: run.id,
      stageId: implementationStage.id,
      actor: "system",
      actorType: "cli",
      action: "implementation.gate.pass",
      summary: `base=${patchBase}; head=${verifiedCommit}`,
    });

    let verificationStageId: number | null = null;
    if (opts.noVerificationGateEvent === true) {
      const verificationStage = store.insertStage(run.id, "verification", implementationStage.id);
      const resultRef = join(".governance", "verification", String(run.id), "result.json");
      mkdirSync(dirname(join(root, resultRef)), { recursive: true });
      // Minimal but strict-valid: the record re-read must pass so only the
      // missing-event refusal can fire.
      writeFileSync(
        join(root, resultRef),
        `${JSON.stringify(
          {
            runId: run.id,
            stageId: verificationStage.id,
            worktreePath,
            verifiedCommit,
            patchBase,
            outcome: "pass",
            blockingCommand: null,
            commands: [],
          },
          null,
          2
        )}\n`
      );
      store.completeStage(verificationStage.id, resultRef, "pass");
      verificationStageId = verificationStage.id;
    } else if (opts.implementationOnly !== true) {
      const verifiedRun = await runVerificationStage(store, { runId: run.id, rootDir: root });
      assert.equal(verifiedRun.ok, true, verifiedRun.ok ? "" : verifiedRun.reason);
      if (verifiedRun.ok) verificationStageId = verifiedRun.stageId;
    }

    return Promise.resolve(
      fn({
        store,
        root,
        runId: run.id,
        startingCommit: head,
        verifiedCommit,
        patchBase,
        worktreePath,
        planPath,
        specPath,
        implementationStageId: implementationStage.id,
        verificationStageId,
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

function review(ctx: Ctx, requestedModel?: string) {
  const { profile } = loadProfile(ctx.root, ctx.runId);
  return runCodeReviewStage(ctx.store, profile.executor, {
    runId: ctx.runId,
    ...(requestedModel === undefined ? {} : { requestedModel }),
    rootDir: ctx.root,
  });
}

function readRecord(root: string, runId: number): CodeReviewRecord {
  return JSON.parse(
    readFileSync(join(root, ".governance", "code-review", String(runId), "result.json"), "utf8")
  ) as CodeReviewRecord;
}

function stageOf(ctx: Ctx) {
  return ctx.store.getStageChain(ctx.runId).find((s) => s.kind === "code_review");
}

function eventsOf(ctx: Ctx, action: string) {
  return ctx.store.getAuditEvents(ctx.runId).filter((e) => e.action === action);
}

function agentRuns(ctx: Ctx, stageId: number) {
  return ctx.store.query<{ id: number; agent: string; role: string; raw_output_ref: string }>(
    "SELECT id, agent, role, raw_output_ref FROM agent_run WHERE stage_id = ? ORDER BY id",
    [stageId]
  );
}

// --- the pass path ----------------------------------------------------------

test("an empty panel result passes, records the panel, and leaves the run in progress", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, true, result.ok ? "" : result.reason);
      if (!result.ok) return;

      const stage = stageOf(ctx)!;
      assert.equal(stage.kind, "code_review");
      assert.equal(stage.status, "passed");
      assert.equal(stage.gate_result, "pass");
      assert.equal(stage.input_stage_id, ctx.verificationStageId);
      assert.equal(stage.output_ref, result.resultRef);
      assert.equal(result.resultRef, codeReviewEvidenceRef(ctx.runId, "result.json"));
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");

      const runs = agentRuns(ctx, stage.id);
      assert.equal(runs.length, 2, "the fixed panel seats both reviewers");
      assert.deepEqual(
        runs.map((r) => r.agent),
        ["code-reviewer-correctness", "code-reviewer-security"]
      );
      assert.ok(runs.every((r) => r.role === "reviewer"));
      // The cwd proof: the fixture read base.txt from its working directory,
      // and the worktree's copy differs from the root's.
      for (const agentRun of runs) {
        const raw = readFileSync(join(ctx.root, agentRun.raw_output_ref), "utf8");
        assert.match(raw, new RegExp(WORKTREE_MARKER), "the reviewer did not run in the worktree");
        assert.ok(!raw.includes(ROOT_MARKER), "the reviewer ran in the repository root");
      }

      const record = readRecord(ctx.root, ctx.runId);
      assert.deepEqual(record.changedPaths, [ARTIFACT]);
      assert.deepEqual(record.panel, ["code-reviewer-correctness", "code-reviewer-security"]);
      assert.equal(record.outcome, "pass");
      assert.deepEqual(record.blocking, []);
      assert.deepEqual(record.proposals, []);
      assert.equal(record.blockingSeverity, "high");
      assert.deepEqual(record.severities, ["low", "medium", "high", "critical"]);
      assert.equal(record.patchBase, ctx.patchBase);
      assert.equal(record.verifiedCommit, ctx.verifiedCommit);
      assert.ok(
        existsSync(join(ctx.root, ".governance", "code-review", String(ctx.runId), "report.md"))
      );

      const passed = eventsOf(ctx, "code_review.gate.pass");
      assert.equal(passed.length, 1);
      assert.match(passed[0]!.summary, /findings=0; blocking=0; threshold=high/);
      assert.equal(verifyAuditChain(ctx.store), null);
    }, "ok");
  });
});

// --- findings below the threshold -------------------------------------------

test("a finding below the frozen threshold passes and is retained as evidence", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, true, result.ok ? "" : result.reason);
      const stage = stageOf(ctx)!;
      assert.equal(stage.status, "passed");

      const findings = ctx.store.getCanonicalFindings(stage.id);
      assert.equal(findings.length, 1);
      assert.equal(findings[0]!.round, 1, "one panel, one round");
      assert.equal(findings[0]!.location, ARTIFACT);
      const reports = ctx.store.getFindingReports(findings[0]!.id);
      assert.equal(reports.length, 1);
      assert.equal(reports[0]!.severity, "low");
      assert.equal(reports[0]!.classification, "current_artifact");

      const record = readRecord(ctx.root, ctx.runId);
      assert.equal(record.findings.length, 1);
      assert.equal(record.findings[0]!.reports[0]!.agent, "code-reviewer-correctness");
      assert.deepEqual(record.blocking, []);
      assert.match(eventsOf(ctx, "code_review.gate.pass")[0]!.summary, /findings=1; blocking=0/);
      assert.equal(eventsOf(ctx, "code_review.finding.record").length, 1);
      assert.equal(verifyAuditChain(ctx.store), null);
    }, "low");
  });
});

// --- the gate ---------------------------------------------------------------

test("a finding at the frozen threshold blocks the run and retains the record", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(
        result.reason,
        /code_review blocked: finding id\(s\) \d+ \(high, severity, [^)]+:12\).*threshold high/
      );

      const stage = stageOf(ctx)!;
      assert.equal(stage.status, "blocked");
      assert.equal(stage.gate_result, "block");
      assert.equal(
        stage.output_ref,
        codeReviewEvidenceRef(ctx.runId, "result.json"),
        "the record is the evidence and survives a block"
      );
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");

      const record = readRecord(ctx.root, ctx.runId);
      assert.equal(record.outcome, "block");
      assert.equal(record.blocking.length, 1);
      assert.equal(record.blocking[0]!.cause, "severity");
      assert.equal(record.blocking[0]!.severity, "high");
      assert.equal(eventsOf(ctx, "code_review.gate.block").length, 1);
      assert.ok(existsSync(ctx.worktreePath), "the worktree survives a block");
      // The panel completes before the gate decides, as the spec panel does.
      assert.equal(agentRuns(ctx, stage.id).length, 2);
      assert.equal(verifyAuditChain(ctx.store), null);
    }, "high");
  });
});

test("the gate reads the frozen threshold, not the live constant", async () => {
  await withVerifiedRun(async (ctx) => {
    refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
      p.policy.codeReviewBlockingSeverity = "critical";
    });
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, true, result.ok ? "" : result.reason);
      assert.match(eventsOf(ctx, "code_review.gate.pass")[0]!.summary, /blocking=0; threshold=critical/);
    }, "high");
  });

  await withVerifiedRun(async (ctx) => {
    refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
      p.policy.codeReviewBlockingSeverity = "low";
    });
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /\(low, severity, /);
      assert.match(result.reason, /threshold low/);
    }, "low");
  });
});

test("the gate orders by the frozen severity list, not the live one", async () => {
  // The live SEVERITIES ascend low -> critical. This run freezes the reverse,
  // in which `low` outranks `high`, so a `low` finding blocks against the
  // seeded `high` threshold. A gate indexing the live constant passes it.
  await withVerifiedRun(async (ctx) => {
    refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
      p.policy.severities = ["critical", "high", "medium", "low"];
    });
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false, "a low finding outranks high in the frozen order");
      if (result.ok) return;
      assert.match(result.reason, /\(low, severity, /);
      const record = readRecord(ctx.root, ctx.runId);
      assert.deepEqual(record.severities, ["critical", "high", "medium", "low"]);
      assert.equal(record.blockingSeverity, "high");
    }, "low");
  });
});

test("two reviewers reporting one identity make one finding with two reports", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false, "the high report blocks");
      const stage = stageOf(ctx)!;
      const findings = ctx.store.getCanonicalFindings(stage.id);
      assert.equal(findings.length, 1, "one canonical finding");
      const reports = ctx.store.getFindingReports(findings[0]!.id);
      assert.equal(reports.length, 2, "two immutable reports, unfused");
      assert.deepEqual(reports.map((r) => r.severity).sort(), ["high", "low"]);
      assert.equal(new Set(reports.map((r) => r.agent_run_id)).size, 2);

      const record = readRecord(ctx.root, ctx.runId);
      assert.equal(record.blocking.length, 1, "the finding blocks once");
      assert.equal(record.blocking[0]!.severity, "high", "the highest severity any report gave it");
      assert.equal(verifyAuditChain(ctx.store), null);
    }, "shared");
  });
});

// --- upstream ---------------------------------------------------------------

test("an upstream finding blocks at any severity and raises a blocking_dependency proposal", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false, "an upstream finding blocks below the threshold");
      if (result.ok) return;
      assert.match(result.reason, /\(low, upstream, upstream:plan:missing-rounding-decision\)/);

      const stage = stageOf(ctx)!;
      assert.equal(stage.status, "blocked");
      assert.equal(stage.output_ref, codeReviewEvidenceRef(ctx.runId, "result.json"));
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");

      const findings = ctx.store.getCanonicalFindings(stage.id);
      assert.equal(findings[0]!.location, "upstream:plan:missing-rounding-decision");
      assert.equal(ctx.store.getFindingReports(findings[0]!.id)[0]!.classification, "upstream");

      const record = readRecord(ctx.root, ctx.runId);
      assert.equal(record.blocking.length, 1);
      assert.deepEqual(record.blocking[0], {
        findingId: findings[0]!.id,
        severity: "low",
        location: "upstream:plan:missing-rounding-decision",
        cause: "upstream",
      });

      const blocked = eventsOf(ctx, "code_review.gate.block")[0]!;
      assert.match(blocked.summary, /cause=upstream/);
      assert.match(blocked.summary, /location=upstream:plan:missing-rounding-decision/);
      assert.match(blocked.summary, new RegExp(`finding=${findings[0]!.id}`));

      // The proposal: a queryable row on the plan's backlog, not a line to
      // dig out of a gate event.
      const proposals = ctx.store.query<{ id: number; route: string; title: string; evidence_ref: string }>(
        "SELECT id, route, title, evidence_ref FROM proposal WHERE stage_id = ?",
        [stage.id]
      );
      assert.equal(proposals.length, 1);
      assert.equal(proposals[0]!.route, "blocking_dependency");
      assert.equal(
        proposals[0]!.title,
        "The approved plan does not state how monetary values are rounded."
      );
      const sources = ctx.store.query<{ finding_id: number }>(
        "SELECT finding_id FROM proposal_source WHERE proposal_id = ?",
        [proposals[0]!.id]
      );
      assert.deepEqual(sources.map((s) => s.finding_id), [findings[0]!.id]);

      const expectedRef = proposalEvidenceRef(ctx.runId, `finding-${findings[0]!.id}.json`);
      assert.equal(proposals[0]!.evidence_ref, expectedRef);
      const evidence = JSON.parse(readFileSync(join(ctx.root, expectedRef), "utf8")) as {
        candidate: { whyUpstream: string };
        rationale: string;
        route: string;
      };
      assert.match(evidence.candidate.whyUpstream, /missing-rounding-decision/);
      assert.match(evidence.rationale, /upstream at severity low/);
      assert.equal(evidence.route, "blocking_dependency");

      assert.equal(eventsOf(ctx, "code_review.proposal.record").length, 1);
      assert.deepEqual(record.proposals, [
        {
          proposalId: proposals[0]!.id,
          findingId: findings[0]!.id,
          route: "blocking_dependency",
          evidenceRef: expectedRef,
        },
      ]);
      assert.match(
        blocked.summary,
        new RegExp(`proposals=${findings[0]!.id}:${proposals[0]!.id}:blocking_dependency:created`)
      );
      assert.equal(verifyAuditChain(ctx.store), null);
    }, "upstream");
  });
});

test("an upstream location without its prefix is refused by the shared validator", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /is not upstream:plan:<decision-key>/);
      assert.equal(eventsOf(ctx, "code_review.reviewer.failed").length, 1);
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
      assert.ok(
        !existsSync(join(ctx.root, ".governance", "code-review", String(ctx.runId), "result.json")),
        "no record is written when a reviewer result is refused"
      );
    }, "bad-location");
  });
});

// --- the location boundary --------------------------------------------------

test("a current_artifact location naming an unchanged path is refused", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /README\.md/);
      assert.match(result.reason, /is not one of the changed paths/);
      const stage = stageOf(ctx)!;
      assert.equal(stage.status, "blocked");
      assert.equal(ctx.store.getCanonicalFindings(stage.id).length, 0, "nothing is recorded");
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
      assert.ok(!existsSync(join(ctx.root, ".governance", "code-review", String(ctx.runId), "result.json")));
    }, "unchanged-path");
  });
});

test("a current_artifact location with a non-positive line is refused", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /line suffix ":0"/);
      assert.match(result.reason, /not a positive integer line number/);
      assert.equal(ctx.store.getCanonicalFindings(stageOf(ctx)!.id).length, 0);
    }, "bad-line");
  });
});

test("validateCodeReviewLocations accepts a changed path with an optional positive line", () => {
  const changed = ["js/a.js", "css/b.css"];
  const at = (
    location: string,
    classification: "current_artifact" | "upstream" = "current_artifact"
  ) => [{ classification, location }];

  for (const good of ["js/a.js", "js/a.js:12", "css/b.css:1"]) {
    assert.equal(validateCodeReviewLocations(at(good), changed), null, `${good} must be accepted`);
  }
  for (const bad of ["js/a.js:0", "js/a.js:x", "js/a.js:1:2", "js/a.jsx", "js/", "## Acceptance criteria"]) {
    assert.notEqual(validateCodeReviewLocations(at(bad), changed), null, `${bad} must be refused`);
  }
  // An empty changed set cannot admit any location at all.
  assert.notEqual(validateCodeReviewLocations(at("js/a.js"), []), null);
  // Upstream reports are the shared validator's business, not this one's.
  assert.equal(
    validateCodeReviewLocations(at("upstream:plan:missing-decision", "upstream"), changed),
    null
  );
});

test("a report whose severity is outside the run's frozen vocabulary is refused", async () => {
  // The sibling of the location backstop: the shared validator checks severity
  // against the live SEVERITIES, and the gate indexes the frozen list, so a
  // severity legal today but absent from what this run froze would reach a
  // gate that could not order it. Refused at the stage boundary instead.
  await withVerifiedRun(async (ctx) => {
    refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
      p.policy.severities = ["low", "medium"];
      p.policy.codeReviewBlockingSeverity = "low";
    });
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /severity "high" is not in the frozen severities low, medium/);
      assert.equal(eventsOf(ctx, "code_review.reviewer.failed").length, 1);
      assert.equal(ctx.store.getCanonicalFindings(stageOf(ctx)!.id).length, 0);
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
    }, "high");
  });
});

test("a changed path carrying a whitespace run can still be cited", async () => {
  // `normalizeLocation` collapses the run on the report's side. Normalizing
  // only there would make this correct report a terminal block no fresh run
  // repairs — the tolerance-at-one-boundary defect, in its concrete form.
  const spaced = "docs/a  b.md";
  assert.equal(validateCodeReviewLocations([{ classification: "current_artifact", location: "docs/a b.md" }], [spaced]), null);
  assert.equal(
    validateCodeReviewLocations([{ classification: "current_artifact", location: "docs/a b.md:7" }], [spaced]),
    null
  );
  // Two paths that differ only in whitespace share one normalized form, and
  // the citation does not say which was meant. Refused, never guessed.
  assert.match(
    String(
      validateCodeReviewLocations(
        [{ classification: "current_artifact", location: "docs/a b.md" }],
        [spaced, "docs/a b.md"]
      )
    ),
    /names more than one changed path/
  );
});

test("codeReviewGate refuses a threshold or severity outside the frozen vocabulary", () => {
  const finding = { id: 1, stage_id: 1, round: 1, intent_key: "k", location: "a.ts" };
  const report = {
    id: 1,
    finding_id: 1,
    agent_run_id: 1,
    severity: "high",
    classification: "current_artifact",
    subject: "s",
  };
  assert.throws(
    () => codeReviewGate([{ finding, reports: [report] }], "severe", ["low", "high"]),
    /the code-review blocking severity severe is not in the frozen severities/
  );
  // The per-report guard, reached only when the threshold itself is in the
  // list — `["low","medium"]` with threshold `high` throws from the threshold
  // branch first, so a case written that way asserts a throw it never reaches.
  assert.throws(
    () => codeReviewGate([{ finding, reports: [report] }], "low", ["low", "medium"]),
    /finding 1 carries severity high, which is not in the frozen severities/
  );
  // A finding nobody reported on cannot block.
  assert.deepEqual(codeReviewGate([{ finding, reports: [] }], "high", ["low", "high"]), { pass: true });
});

// --- the read-only boundary and the result contract --------------------------

test("a reviewer that writes into the worktree is refused, naming what it left", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /reviewer-residue\.txt/);
      assert.equal(eventsOf(ctx, "code_review.worktree.dirty").length, 1);
      assert.equal(ctx.store.getCanonicalFindings(stageOf(ctx)!.id).length, 0);
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
      assert.ok(!existsSync(join(ctx.root, ".governance", "code-review", String(ctx.runId), "result.json")));
    }, "mutate");
  });
});

test("a reviewer that cannot review must not pass the gate by absence", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /not proposed — a reviewer that cannot review must not pass the gate by absence/);
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
    }, "non-proposed");
  });
});

test("a prose result is refused at the body boundary", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /body refused/);
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
    }, "prose");
  });
});

// --- the preconditions, each refused by name before the stage row ------------

/** Every precondition refusal leaves no stage row and the run untouched. */
function assertNoStage(ctx: Ctx): void {
  assert.equal(stageOf(ctx), undefined, "no code_review stage row may exist");
  assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");
}

test("a nonexistent run is refused by name", async () => {
  await withVerifiedRun(async (ctx) => {
    const { profile } = loadProfile(ctx.root, ctx.runId);
    const result = await runCodeReviewStage(ctx.store, profile.executor, {
      runId: 9999,
      rootDir: ctx.root,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /run 9999 does not exist/);
  });
});

test("a run that is not in progress is refused", async () => {
  await withVerifiedRun(async (ctx) => {
    ctx.store.setRunStatus(ctx.runId, "blocked");
    const result = await review(ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /blocked/);
    assert.equal(stageOf(ctx), undefined);
  });
});

test("a second code_review stage is refused, naming the first's status", async () => {
  await withVerifiedRun(async (ctx) => {
    await withMode(async () => {
      assert.equal((await review(ctx)).ok, true);
      const second = await review(ctx);
      assert.equal(second.ok, false);
      if (second.ok) return;
      assert.match(second.reason, /already has a code_review stage with status passed/);
    }, "ok");
  });
});

test("a last stage that is not a passed verification is refused", async () => {
  await withVerifiedRun(
    async (ctx) => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /last stage is implementation \(passed\), not a passed verification/);
      assertNoStage(ctx);
    },
    { implementationOnly: true }
  );
});

test("a missing worktree is refused by name", async () => {
  await withVerifiedRun(async (ctx) => {
    const removed = git(ctx.root, ["worktree", "remove", "--force", ctx.worktreePath]);
    assert.equal(removed.status, 0, removed.stderr);
    const result = await review(ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /worktree for run \d+ is missing/);
    assertNoStage(ctx);
  });
});

test("a worktree whose head has moved is refused", async () => {
  await withVerifiedRun(async (ctx) => {
    const empty = git(ctx.worktreePath, [
      "-c",
      "user.email=t@t.invalid",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "moved",
    ]);
    assert.equal(empty.status, 0, empty.stderr);
    const result = await review(ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /not the verified commit/);
    assertNoStage(ctx);
  });
});

test("a dirty worktree is refused before any dispatch", async () => {
  await withVerifiedRun(async (ctx) => {
    writeFileSync(join(ctx.worktreePath, "stray.txt"), "left behind\n");
    const result = await review(ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    // The porcelain status prefix travels with the entry, as it does in the
    // implementation stage's refusal: what matters is that the path is named.
    assert.match(result.reason, /worktree is not clean before code review: .*stray\.txt/);
    assertNoStage(ctx);
  });
});

test("a profile modified since intake is refused", async () => {
  await withVerifiedRun(async (ctx) => {
    const path = join(ctx.root, ".governance", "profiles", String(ctx.runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    profile.systemName = "tampered";
    writeFileSync(path, canonicalJson(profile));
    const result = await review(ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /profile/);
    assertNoStage(ctx);
  });
});

test("a run past its frozen duration limit is refused, naming the limit", async () => {
  await withVerifiedRun(async (ctx) => {
    refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
      p.policy.runDurationLimitSeconds = 1;
    });
    ctx.store.exec("UPDATE run SET created_at = ? WHERE id = ?", [
      new Date(Date.now() - 3600_000).toISOString(),
      ctx.runId,
    ]);
    const result = await review(ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /exceeded the run-duration limit of 1 seconds/);
    assertNoStage(ctx);
  });
});

test("a missing verification record is refused by name", async () => {
  await withVerifiedRun(async (ctx) => {
    rmSync(join(ctx.root, ".governance", "verification", String(ctx.runId), "result.json"));
    const result = await review(ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /verification record at .* is missing/);
    assertNoStage(ctx);
  });
});

test("a verification record edited to block is refused as invalid", async () => {
  await withVerifiedRun(async (ctx) => {
    const path = join(ctx.root, ".governance", "verification", String(ctx.runId), "result.json");
    const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    record.outcome = "block";
    writeFileSync(path, JSON.stringify(record, null, 2));
    const result = await review(ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /verification record at .* is invalid/);
    assertNoStage(ctx);
  });
});

test("a passed verification with no gate event is refused before anything is dispatched", async () => {
  // The crash gap: verification completes its stage and appends its event as
  // separate writes, so a crash between them leaves a passed row whose outcome
  // the audit never recorded. Two paid dispatches must not be spent on one.
  await withVerifiedRun(
    async (ctx) => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /has no verification\.gate\.pass audit event/);
      assertNoStage(ctx);
      // `agent_run` is keyed by stage; this run is the only one in the store,
      // so an empty table is the whole claim: nothing was dispatched.
      assert.equal(ctx.store.query("SELECT id FROM agent_run").length, 0, "nothing was dispatched");
      assert.equal(verifyAuditChain(ctx.store), null, "the gap is a missing event, not a broken chain");
    },
    { noVerificationGateEvent: true }
  );
});

test("a spec edited after approval is refused", async () => {
  await withVerifiedRun(async (ctx) => {
    writeFileSync(ctx.specPath, "# tampered\n");
    const result = await review(ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /the spec has changed since approval/);
    assertNoStage(ctx);
  });
});

test("a plan edited after the gate is refused", async () => {
  await withVerifiedRun(async (ctx) => {
    writeFileSync(ctx.planPath, "# tampered plan\n");
    const result = await review(ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /the plan has changed since review/);
    assertNoStage(ctx);
  });
});

test("a missing plan gate event is refused", async () => {
  await withVerifiedRun(
    async (ctx) => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /has no plan\.gate\.pass audit event/);
      assertNoStage(ctx);
    },
    { noPlanGateEvent: true }
  );
});

test("an executor frozen without the review capability is refused", async () => {
  await withVerifiedRun(
    async (ctx) => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /lacks the required capability "review" for stage kind code_review/);
      assertNoStage(ctx);
    },
    { executor: fixtureExecutor(FIXTURE, ["spec", "plan", "implementation"]) }
  );
});

test("a --model disagreeing with the frozen model is refused", async () => {
  await withVerifiedRun(async (ctx) => {
    const result = await review(ctx, "other-model");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /--model other-model does not match the model frozen at run start \(m\)/);
    assertNoStage(ctx);
  });
});

test("a frozen registry that cannot seat the panel is refused at the stage boundary too", async () => {
  await withVerifiedRun(async (ctx) => {
    refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
      p.agents = p.agents.filter((a) => a.id !== "code-reviewer-security");
    });
    const result = await review(ctx);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /cannot seat a code-review panel/);
    assert.match(result.reason, /seats 1 code reviewer/);
    assertNoStage(ctx);
  });
});

test("a verified range that changed no files is refused before the stage row", async () => {
  await withVerifiedRun(
    async (ctx) => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /changed no files/);
      assertNoStage(ctx);
    },
    { commitFiles: [] }
  );
});

// --- the wedge guard ---------------------------------------------------------

test("an unexpected throw lands in the same terminal state as any other failure", async () => {
  await withVerifiedRun(async (ctx) => {
    // Occupy the evidence directory's path with a file so mkdirSync throws
    // inside the guarded body, after the panel has been dispatched.
    const dir = join(ctx.root, ".governance", "code-review");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, String(ctx.runId)), "in the way\n");
    await withMode(async () => {
      const result = await review(ctx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /code review stage failed/);
      assert.equal(stageOf(ctx)!.status, "blocked");
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
      assert.equal(eventsOf(ctx, "code_review.stage.failed").length, 1);
      assert.equal(verifyAuditChain(ctx.store), null);
    }, "ok");
  });
});

// --- the recorded real responses (plan Task 10) -----------------------------

/**
 * The two reviewer responses from the first paid chain to reach `code_review`,
 * 2026-09-06, target `bw-run-skill/1788742310835`. Hard rule 5 and section 21
 * are why they are here: `emit-code-review.mjs` proves the stage matches its
 * author's reading of the contract, and only a real response proves the
 * contract with the provider — the envelope, the result shape, the case of a
 * constrained field, and the form a live reviewer gives a location. Each
 * fixture's `provenance.stageContext` carries the changed paths, the frozen
 * severities and threshold, and the verdict the stage recorded, read from the
 * run's own `result.json` rather than retyped.
 */
type RecordedReview = {
  provenance: {
    agent: string;
    stageContext: {
      changedPaths: string[];
      severities: string[];
      blockingSeverity: string;
      recordedVerdict: "pass" | "block";
      recordedBlocking: { location: string; severity: string; cause: string }[];
      recordedFindingLocations: string[];
    };
  };
  envelope: { result: string };
};

function recordedReview(name: string): RecordedReview {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/recorded/${name}`, import.meta.url), "utf8")
  ) as RecordedReview;
}

/**
 * The chain the stage runs over one reviewer's body, in the stage's order and
 * with the stage's arguments — `runCodeReviewStage` lines 683-747 — up to the
 * rows it would insert. Returns the validated reports.
 */
function replayReviewer(fixture: RecordedReview) {
  const { agent, stageContext } = fixture.provenance;
  const body = extractJsonBody(fixture.envelope.result);
  assert.equal(body.kind, "ok", `the recorded body must extract; got ${JSON.stringify(body)}`);
  if (body.kind !== "ok") throw new Error("unreachable");
  const result = validateAgentResult(agent, body.value);
  assert.equal(result.ok, true, `the recorded result must validate; got ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.value.status, "proposed");
  const content = result.value.proposedContentChanges as { findings?: unknown };
  assert.ok(Array.isArray(content.findings), "the recorded result carries proposedContentChanges.findings");
  const reports = validateReviewerReports(content.findings, {
    agentId: agent,
    upstreamPrefix: upstreamPrefixFor("plan"),
  });
  assert.equal(reports.ok, true, `the recorded reports must validate; got ${JSON.stringify(reports)}`);
  if (!reports.ok) throw new Error("unreachable");
  assert.equal(validateCodeReviewLocations(reports.value, stageContext.changedPaths), null);
  for (const report of reports.value) {
    assert.ok(stageContext.severities.includes(report.severity), `severity ${report.severity} is frozen`);
  }
  return reports.value;
}

test("the recorded correctness response replays to the block the stage recorded", () => {
  const fixture = recordedReview("code-review-web-calculator-correctness-two-high-findings.json");
  const { stageContext } = fixture.provenance;
  // Shape 1 of hazard 1, live: the body is bare JSON with no fence.
  assert.ok(fixture.envelope.result.trim().startsWith("{"));

  const reports = replayReviewer(fixture);
  assert.equal(reports.length, 2);
  // A live reviewer writes `path:line` inside the changed set — the location
  // form the validator accepts and the plan named as the likeliest live
  // refusal (a range, a column, a parenthetical). Neither happened.
  assert.deepEqual(
    reports.map((r) => r.location),
    stageContext.recordedFindingLocations
  );
  assert.ok(reports.every((r) => r.classification === "current_artifact"));

  // The gate, over rows shaped as the store would hold them, with the frozen
  // threshold and order the run recorded.
  const rows = reports.map((report, i) => ({
    finding: { id: i + 2, stage_id: 8, round: 1, intent_key: report.intentKey, location: report.location },
    reports: [
      {
        id: i + 2,
        finding_id: i + 2,
        agent_run_id: 12,
        severity: report.severity,
        classification: report.classification,
        subject: report.subject,
      },
    ],
  }));
  const verdict = codeReviewGate(rows, stageContext.blockingSeverity, stageContext.severities);
  assert.equal(stageContext.recordedVerdict, "block");
  assert.equal(verdict.pass, false);
  if (verdict.pass) return;
  assert.deepEqual(
    verdict.blocking.map((b) => ({ location: b.location, severity: b.severity, cause: b.cause })),
    stageContext.recordedBlocking
  );
});

test("the recorded security response — an empty panel in a fence — replays clean and proves only the pass path", () => {
  const fixture = recordedReview("code-review-web-calculator-security-empty-fenced.json");
  const { stageContext } = fixture.provenance;
  // Shape 2 of hazard 1, live: the same run's other reviewer fenced its body.
  assert.ok(fixture.envelope.result.trim().startsWith("```json"));

  const reports = replayReviewer(fixture);
  assert.equal(reports.length, 0);
  // Alone, this reviewer would have passed the gate. It did not decide the
  // run — the correctness reviewer did — and this test claims nothing about
  // the finding or location contract.
  const verdict = codeReviewGate([], stageContext.blockingSeverity, stageContext.severities);
  assert.deepEqual(verdict, { pass: true });
});

test("the second recorded correctness response — prose, then a fence, one high finding — replays to its block", () => {
  const fixture = recordedReview("code-review-web-calculator-correctness-enter-double-activation.json");
  const { stageContext } = fixture.provenance;
  // Shape 3 of hazard 1, live: a sentence of prose before a single fence. The
  // same reviewer on a different implementation of the same design.
  const body = fixture.envelope.result.trim();
  assert.ok(!body.startsWith("{") && !body.startsWith("```") && body.includes("```json"));

  const reports = replayReviewer(fixture);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports.map((r) => r.location), stageContext.recordedFindingLocations);

  const rows = reports.map((report) => ({
    finding: { id: 3, stage_id: 8, round: 1, intent_key: report.intentKey, location: report.location },
    reports: [
      {
        id: 3,
        finding_id: 3,
        agent_run_id: 12,
        severity: report.severity,
        classification: report.classification,
        subject: report.subject,
      },
    ],
  }));
  const verdict = codeReviewGate(rows, stageContext.blockingSeverity, stageContext.severities);
  assert.equal(stageContext.recordedVerdict, "block");
  assert.equal(verdict.pass, false);
  if (verdict.pass) return;
  assert.deepEqual(
    verdict.blocking.map((b) => ({ location: b.location, severity: b.severity, cause: b.cause })),
    stageContext.recordedBlocking
  );
});
