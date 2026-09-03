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
import { runDeliveryStage } from "../src/delivery-stage.ts";
import { runVerificationStage } from "../src/verification-stage.ts";
import { freezeProfile, loadProfile } from "../src/profile.ts";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { policyHash } from "../src/policy.ts";
import type { Profile } from "../src/profile.ts";
import type { VerificationConfig } from "../src/governed-config.ts";

/** A passing command whose fixture writes nothing, so the worktree stays clean. */
const VERIFICATION: VerificationConfig = {
  commands: [{ name: "ok", command: ["node", join(process.cwd(), "test", "fixtures", "verify", "exit-zero.mjs")] }],
};
const MODEL = "m";
const SLUG = "demo";
const ARTIFACT = "src/a1.ts";

interface Ctx {
  store: Store;
  root: string;
  runId: number;
  /** The signed starting commit the run branch was created at. */
  startingCommit: string;
  verifiedCommit: string;
  /** The pre-apply head the gate event recorded — the starting commit's child. */
  patchBase: string;
  worktreePath: string;
  implementationStageId: number;
  verificationStageId: number;
}

interface Opts {
  scope?: string[];
  /** Files committed on the run branch between the patch base and the verified head. */
  commitFiles?: string[];
  /** Extra files left untracked in the worktree after verification. */
  untracked?: string[];
  /** Files removed (committed deletions) inside the range after the patch commit. */
  deleteFiles?: string[];
  /**
   * Complete the verification stage by hand without its gate event — the
   * only state in which the missing-event refusal is reachable, since the
   * real stage always appends the event.
   */
  noGateEvent?: boolean;
}

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
 * A run parked at the delivery boundary through the real stages: real git
 * repository, real worktree on the run branch, the run's spec and plan
 * projections committed on the branch first (so the pre-apply head the gate
 * event records is the starting commit's child — the shape every honest run
 * has), a commit of the declared files on the branch, the gate event
 * recording both commits, and a real verification stage run to completion so
 * the record delivery reads exists and was written by the shipped code.
 * Nothing is dispatched anywhere.
 */
async function withDeliveryRun(fn: (ctx: Ctx) => Promise<void>, opts: Opts = {}): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-delivery-"));
  const store = openStore(root);
  try {
    const init = git(root, ["init", "-q"]);
    assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
    writeFileSync(join(root, ".gitignore"), ".governance/\n");
    writeFileSync(join(root, "base.txt"), "base\n");
    const addBase = git(root, ["add", "-A"]);
    assert.equal(addBase.status, 0, `git add failed: ${addBase.stderr}`);
    commitIn(root, "base");
    const head = git(root, ["rev-parse", "HEAD"]).stdout.trim();

    const run = store.insertRun("p", "f-1", SLUG, "feature");
    const frozen = freezeProfile(root, run.id, head, MODEL, VERIFICATION);
    store.setProfileRef(run.id, frozen.hash);

    const scope = opts.scope ?? [ARTIFACT];
    const specPath = join(root, "docs", "features", SLUG, "spec.md");
    mkdirSync(dirname(specPath), { recursive: true });
    const spec = `feature: demo
change_kind: feature

## Declared artifacts

${scope.map((p) => `- ${p}`).join("\n")}

## Acceptance criteria

- the artifact is committed
`;
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

    const worktreePath = join(root, ".governance", "worktrees", String(run.id));
    const added = git(root, ["worktree", "add", "-q", worktreePath, "-b", `gov/${SLUG}/${run.id}`, head]);
    assert.equal(added.status, 0, `git worktree add failed: ${added.stderr}`);

    // The run's own projections, committed on the branch before the
    // implementer sees it — the real implementation stage writes the spec and
    // plan into the worktree and commits them before its first apply, so the
    // recorded base is the head after this commit: a proper descendant of the
    // signed starting commit, never the starting commit itself. Every fixture
    // commits them, so a regression that anchored the changed-set diff at the
    // starting commit would pull these projection paths into the range and
    // fail the named tests.
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

    // The "implementation": commit the declared files on the run branch, then
    // apply any in-range deletions the test asks for.
    for (const file of opts.commitFiles ?? scope) {
      const target = join(worktreePath, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `content of ${file}\n`);
    }
    if ((opts.commitFiles ?? scope).length > 0) {
      const addPatch = git(worktreePath, ["--literal-pathspecs", "add", "--", ...(opts.commitFiles ?? scope)]);
      assert.equal(addPatch.status, 0, `git add failed: ${addPatch.stderr}`);
      commitIn(worktreePath, `bw run ${run.id}: apply patch`);
    }
    if ((opts.deleteFiles ?? []).length > 0) {
      const remove = git(worktreePath, ["rm", "-q", "--", ...(opts.deleteFiles ?? [])]);
      assert.equal(remove.status, 0, `git rm failed: ${remove.stderr}`);
      commitIn(worktreePath, `bw run ${run.id}: remove in range`);
    }
    const verifiedCommit = git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();

    const implementationStage = store.insertStage(run.id, "implementation", approvalStage.id);
    store.completeStage(implementationStage.id, worktreePath, "pass");
    appendAudit(store, {
      runId: run.id,
      stageId: implementationStage.id,
      actor: "system",
      actorType: "cli",
      action: "implementation.gate.pass",
      summary: `base=${patchBase}; head=${verifiedCommit}`,
    });

    // The real verification stage writes the record delivery re-reads; the
    // noGateEvent option instead completes the stage by hand without its
    // audit event, the one state in which delivery's missing-event refusal is
    // reachable.
    let verificationStageId: number;
    if (opts.noGateEvent === true) {
      const verificationStage = store.insertStage(run.id, "verification", implementationStage.id);
      const resultRef = `.governance/verification/${run.id}/result.json`;
      mkdirSync(dirname(join(root, resultRef)), { recursive: true });
      // Minimal but strict-valid: delivery's record re-read must pass so only
      // the missing-event refusal can fire.
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
    } else {
      const verifiedRun = await runVerificationStage(store, { runId: run.id, rootDir: root });
      assert.equal(verifiedRun.ok, true, verifiedRun.ok ? "" : verifiedRun.reason);
      const verificationStage = store.getStage(verifiedRun.stageId)!;
      assert.equal(verificationStage.kind, "verification");
      verificationStageId = verificationStage.id;
    }

    for (const file of opts.untracked ?? []) {
      const target = join(worktreePath, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "leftover\n");
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

function deliveryRecord(root: string, runId: number) {
  return JSON.parse(
    readFileSync(join(root, ".governance", "delivery", String(runId), "result.json"), "utf8")
  ) as {
    stageId: number;
    delivered: string[];
    missing: string[];
    outcome: string;
    patchBase: string;
    verifiedCommit: string;
  };
}

// --- the pass path ----------------------------------------------------------

test("every declared artifact committed on the run branch passes delivery and completes the run", async () => {
  await withDeliveryRun(async (ctx) => {
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    if (!result.ok) return;

    const chain = ctx.store.getStageChain(ctx.runId);
    const stage = chain.find((s) => s.kind === "delivery_check")!;
    assert.equal(stage.status, "passed");
    assert.equal(stage.gate_result, "pass");
    assert.equal(stage.input_stage_id, ctx.verificationStageId);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "completed");
    assert.equal(stage.output_ref, result.resultRef);

    const record = deliveryRecord(ctx.root, ctx.runId);
    assert.deepEqual(record.delivered, [ARTIFACT]);
    assert.deepEqual(record.missing, []);
    assert.equal(record.outcome, "pass");
    assert.equal(record.patchBase, ctx.patchBase);
    assert.equal(record.verifiedCommit, ctx.verifiedCommit);
    assert.equal(record.stageId, stage.id, "the record names the delivery_check stage that wrote it");
    assert.ok(existsSync(join(ctx.root, ".governance", "delivery", String(ctx.runId), "report.md")));

    const audit = ctx.store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'delivery.gate.pass' ORDER BY id DESC LIMIT 1",
      [ctx.runId]
    )[0]!;
    assert.match(audit.summary, new RegExp(`delivered 1 artifact\\(s\\): ${ARTIFACT}`));
    assert.equal(verifyAuditChain(ctx.store), null);
  });
});

test("no agent_run row exists: the stage spends nothing", async () => {
  await withDeliveryRun(async (ctx) => {
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    const rows = ctx.store.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ?",
      [ctx.runId]
    );
    assert.equal(rows[0]!.n, 0);
  });
});

test("untracked files appearing after verification never block delivery", async () => {
  // The branch is the deliverable and untracked bytes cannot enter it.
  // Verification itself leaves no residue — it refuses any post-command
  // dirt, untracked included — so the only untracked files delivery can
  // ever see are ones appearing between verify and deliver (this fixture
  // adds them after the real verification has run), and those are
  // tolerated precisely because they cannot enter the branch.
  await withDeliveryRun(
    async (ctx) => {
      const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, true, result.ok ? "" : result.reason);
    },
    { untracked: ["coverage/lcov.info", "tmp-out.txt"] }
  );
});

// --- the block path: one artifact missing ----------------------------------

test("a declared artifact never committed blocks the stage and the run, naming the path", async () => {
  await withDeliveryRun(
    async (ctx) => {
      const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /delivery blocked: declared artifact\(s\) never appear/);
      assert.match(result.reason, /test\/a1\.test\.ts/);
      const chain = ctx.store.getStageChain(ctx.runId);
      const stage = chain.find((s) => s.kind === "delivery_check")!;
      assert.equal(stage.status, "blocked");
      assert.equal(stage.gate_result, "block");
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
      const record = deliveryRecord(ctx.root, ctx.runId);
      assert.deepEqual(record.missing, ["test/a1.test.ts"]);
      assert.equal(record.outcome, "block");
      const audit = ctx.store.query<{ summary: string }>(
        "SELECT summary FROM audit WHERE run_id = ? AND action = 'delivery.gate.block' ORDER BY id DESC LIMIT 1",
        [ctx.runId]
      )[0]!;
      assert.match(audit.summary, /test\/a1\.test\.ts/);
      assert.equal(verifyAuditChain(ctx.store), null);
    },
    { scope: [ARTIFACT, "test/a1.test.ts"], commitFiles: [ARTIFACT] }
  );
});

test("projection-only commits never satisfy delivery", async () => {
  // The base is the post-projection head, so the diff range excludes the
  // run's own spec and plan projections even though they are committed on the
  // branch before the base... Here the fixture commits only a projection-like
  // doc path *inside the range* — but it is not a declared artifact, and a
  // declared artifact that only "moved under" a changed directory still
  // blocks. The declared file is simply not there.
  await withDeliveryRun(
    async (ctx) => {
      const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /never appear in the committed changes/);
    },
    { scope: [ARTIFACT], commitFiles: ["docs/features/demo/notes.md"] }
  );
});

// --- every other refusal, by name, before any mutation ----------------------

test("a nonexistent run is refused by name", async () => {
  await withDeliveryRun(async (ctx) => {
    const result = await runDeliveryStage(ctx.store, { runId: 9999, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match(result.reason, /run 9999 does not exist/);
  });
});

test("a run not in progress is refused by name", async () => {
  await withDeliveryRun(async (ctx) => {
    ctx.store.setRunStatus(ctx.runId, "blocked");
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match(result.reason, /is blocked, not in_progress/);
  });
});

test("a second delivery invocation refuses: the completed run is terminal", async () => {
  await withDeliveryRun(async (ctx) => {
    const first = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(first.ok, true, first.ok ? "" : first.reason);
    const second = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(second.ok, false);
    // The run-state guard fires before the stage-duplicate guard: a passed
    // delivery completes the run, and a completed run can never finish again.
    assert.match(second.reason, /is completed, not in_progress/);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "completed");
  });
});

test("a run already holding a delivery_check stage refuses by name before any re-finalization", async () => {
  await withDeliveryRun(async (ctx) => {
    // The transaction makes this state unreachable through the stage, so it
    // is constructed directly: the chain guard is the belt behind the run
    // guard, and it must name the existing stage's status.
    const verificationStage = ctx.store.getStage(ctx.verificationStageId)!;
    ctx.store.insertStage(ctx.runId, "delivery_check", verificationStage.id);
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /already has a delivery_check stage with status pending/);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");
  });
});

test("a last stage that is not a passed verification is refused by name", async () => {
  await withDeliveryRun(async (ctx) => {
    const stage = ctx.store.getStage(ctx.verificationStageId)!;
    ctx.store.completeStage(stage.id, stage.output_ref ?? "", "block");
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match(result.reason, /last stage is verification \(blocked\), not a passed verification/);
  });
});

test("a run past the frozen duration limit is refused by name", async () => {
  await withDeliveryRun(async (ctx) => {
    // The limit stays a real one and the run is what goes stale: re-freeze
    // with the limit lowered, recompute both hashes, and backdate the run.
    const { profile } = loadProfile(ctx.root, ctx.runId);
    (profile as Profile).policy.runDurationLimitSeconds = 1;
    profile.policyHash = policyHash(profile.policy);
    const serialized = canonicalJson(profile);
    writeFileSync(join(ctx.root, ".governance", "profiles", String(ctx.runId), "profile.json"), serialized);
    ctx.store.setProfileRef(ctx.runId, sha256Hex(serialized));
    ctx.store.exec("UPDATE run SET created_at = ? WHERE id = ?", [
      new Date(Date.now() - 3600_000).toISOString(),
      ctx.runId,
    ]);
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match(result.reason, /exceeded the run-duration limit of 1 seconds/);
  });
});

test("a moved worktree head is refused by name", async () => {
  await withDeliveryRun(async (ctx) => {
    writeFileSync(join(ctx.worktreePath, "base.txt"), "changed after verification\n");
    const add = git(ctx.worktreePath, ["add", "-A"]);
    assert.equal(add.status, 0, add.stderr);
    const commit = git(ctx.worktreePath, [
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "-m",
      "moved after verification",
    ]);
    assert.equal(commit.status, 0, commit.stderr);
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match(result.reason, /not the verified commit/);
  });
});

test("tracked changes after verification refuse by name with the paths", async () => {
  await withDeliveryRun(async (ctx) => {
    writeFileSync(join(ctx.worktreePath, "base.txt"), "dirty\n");
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match(result.reason, /tracked changes since the verified commit: base\.txt/);
  });
});

test("a forged patch base that is not on the run branch refuses by ancestry", async () => {
  await withDeliveryRun(async (ctx) => {
    // Rewrite the verification record with a real commit that is not on the
    // run branch: an empty commit on the main repository after the branch was
    // created. It parses as a commit, so only the ancestry checks can refuse
    // it.
    const foreign = git(ctx.root, ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "foreign"]);
    assert.equal(foreign.status, 0, foreign.stderr);
    const foreignHead = git(ctx.root, ["rev-parse", "HEAD"]).stdout.trim();
    const recordPath = join(ctx.root, ".governance", "verification", String(ctx.runId), "result.json");
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    record.patchBase = foreignHead;
    writeFileSync(recordPath, JSON.stringify(record));
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, new RegExp(`the patch base ${foreignHead} is not an ancestor of`));
    // Nothing was mutated: no stage row, run still in_progress.
    assert.equal(
      ctx.store.getStageChain(ctx.runId).some((s) => s.kind === "delivery_check"),
      false
    );
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");
  });
});

test("a broken verification record refuses by name, never trusted", async () => {
  await withDeliveryRun(async (ctx) => {
    const recordPath = join(ctx.root, ".governance", "verification", String(ctx.runId), "result.json");
    writeFileSync(recordPath, "{ not json");
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match(result.reason, /verification record at .* is invalid/);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");
  });
});

test("a missing worktree is refused by name", async () => {
  await withDeliveryRun(async (ctx) => {
    rmSync(ctx.worktreePath, { recursive: true, force: true });
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match(result.reason, /worktree for run \d+ is missing at/);
  });
});

test("a crash mid-finalization leaves the run retryable, not wedged", async () => {
  await withDeliveryRun(async (ctx) => {
    // Fail inside the final transaction, after the stage insert: everything
    // must roll back, leaving the run in_progress with no delivery_check and
    // a record file that the retry safely overwrites.
    const real = ctx.store.setRunStatus.bind(ctx.store);
    (ctx.store as { setRunStatus: unknown }).setRunStatus = () => {
      throw new Error("simulated crash mid-delivery");
    };
    const first = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(first.ok, false);
    assert.match(first.reason, /simulated crash mid-delivery/);
    (ctx.store as { setRunStatus: unknown }).setRunStatus = real;

    assert.equal(
      ctx.store.getStageChain(ctx.runId).some((s) => s.kind === "delivery_check"),
      false,
      "the half-written stage must have rolled back"
    );
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");

    const retry = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(retry.ok, true, retry.ok ? "" : retry.reason);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "completed");
    assert.equal(verifyAuditChain(ctx.store), null, "the rolled-back audit inserts left no gap");
  });
});

// --- the 2026-09-03 code-review remediations ---------------------------------

test("a declared file that existed at the starting commit and was modified in range is delivered", async () => {
  await withDeliveryRun(
    async (ctx) => {
      const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, true, result.ok ? "" : result.reason);
    },
    { scope: ["base.txt"], commitFiles: ["base.txt"] }
  );
});

test("a declared artifact deleted inside the range blocks delivery: a removal is never delivery", async () => {
  await withDeliveryRun(
    async (ctx) => {
      const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /delivery blocked: declared artifact\(s\) never appear/);
      assert.match(result.reason, /base\.txt/);
      const stage = ctx.store.getStageChain(ctx.runId).find((s) => s.kind === "delivery_check")!;
      assert.equal(stage.status, "blocked");
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
      const record = deliveryRecord(ctx.root, ctx.runId);
      assert.deepEqual(record.delivered, []);
      assert.deepEqual(record.missing, ["base.txt"]);
    },
    { scope: ["base.txt"], commitFiles: [], deleteFiles: ["base.txt"] }
  );
});

test("the run's own projection documents never count as delivered: they sit before the base", async () => {
  // The projections commit precedes the recorded base, so spec.md and plan.md
  // are outside the certified range. A regression that anchored the changed
  // set at the starting commit would pull them into the range and this run
  // would complete; it must block instead.
  await withDeliveryRun(
    async (ctx) => {
      const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, new RegExp(`docs/features/${SLUG}/spec\\.md`));
    },
    { scope: [`docs/features/${SLUG}/spec.md`], commitFiles: [] }
  );
});

test("a forged patch base equal to the starting commit refuses by strict descent", async () => {
  await withDeliveryRun(async (ctx) => {
    const recordPath = join(ctx.root, ".governance", "verification", String(ctx.runId), "result.json");
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    record.patchBase = ctx.startingCommit;
    writeFileSync(recordPath, JSON.stringify(record));
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(
      result.reason,
      new RegExp(`the patch base ${ctx.startingCommit} is the starting commit, not a proper descendant`)
    );
    assert.equal(
      ctx.store.getStageChain(ctx.runId).some((s) => s.kind === "delivery_check"),
      false
    );
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");
  });
});

test("a passed verification whose gate event is absent refuses: the audit must record the outcome", async () => {
  await withDeliveryRun(
    async (ctx) => {
      const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /has no verification\.gate\.pass audit event/);
      assert.equal(
        ctx.store.getStageChain(ctx.runId).some((s) => s.kind === "delivery_check"),
        false,
        "no delivery stage may be created"
      );
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");
    },
    { noGateEvent: true }
  );
});

test("a missing verification record refuses by name and names the repair", async () => {
  await withDeliveryRun(async (ctx) => {
    rmSync(join(ctx.root, ".governance", "verification", String(ctx.runId), "result.json"));
    const result = await runDeliveryStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /verification record at .* is missing: restore it/);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");
  });
});
